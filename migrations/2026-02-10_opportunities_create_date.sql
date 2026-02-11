-- Add create_date_raw + create_date to opportunities and keep create_date parsed.
-- Safe to run multiple times (best-effort).

-- 1) Columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='opportunities') THEN
    ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS create_date_raw text;
    ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS create_date timestamptz;
  END IF;
END $$;

-- 2) Tolerant timestamptz parser
-- Accepts:
-- - ISO8601 strings (via ::timestamptz cast)
-- - Common US date strings (M/D/YYYY with optional time)
-- - Epoch seconds / epoch milliseconds (numeric)
-- - Excel date serial numbers (numeric)
CREATE OR REPLACE FUNCTION try_parse_timestamptz(raw text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  n double precision;
  ts timestamptz;
BEGIN
  s := NULLIF(BTRIM(raw), '');
  IF s IS NULL THEN
    RETURN NULL;
  END IF;

  -- Numeric forms: epoch ms/s or Excel serial.
  IF s ~ '^[0-9]+(\.[0-9]+)?$' THEN
    n := s::double precision;

    -- Epoch ms (13 digits-ish)
    IF n >= 100000000000 THEN
      RETURN to_timestamp(n / 1000.0);
    END IF;
    -- Epoch seconds (10 digits-ish)
    IF n >= 1000000000 THEN
      RETURN to_timestamp(n);
    END IF;
    -- Excel serial date (days since 1899-12-30)
    IF n >= 20000 AND n <= 90000 THEN
      RETURN (timestamptz '1899-12-30 00:00:00+00' + (n * interval '1 day'));
    END IF;
  END IF;

  -- Let Postgres handle most real-world formats (includes ISO8601 with TZ).
  BEGIN
    ts := s::timestamptz;
    RETURN ts;
  EXCEPTION WHEN others THEN
    -- continue
  END;

  -- Common CRM/Excel string formats without timezone: interpret as UTC.
  BEGIN
    RETURN (to_timestamp(s, 'YYYY-MM-DD HH24:MI:SS') AT TIME ZONE 'UTC');
  EXCEPTION WHEN others THEN
  END;

  BEGIN
    RETURN (to_timestamp(s, 'YYYY-MM-DD HH24:MI') AT TIME ZONE 'UTC');
  EXCEPTION WHEN others THEN
  END;

  BEGIN
    RETURN (to_timestamp(s, 'YYYY-MM-DD') AT TIME ZONE 'UTC');
  EXCEPTION WHEN others THEN
  END;

  BEGIN
    RETURN (to_timestamp(s, 'FMMM/FMDD/YYYY HH24:MI:SS') AT TIME ZONE 'UTC');
  EXCEPTION WHEN others THEN
  END;

  BEGIN
    RETURN (to_timestamp(s, 'FMMM/FMDD/YYYY HH24:MI') AT TIME ZONE 'UTC');
  EXCEPTION WHEN others THEN
  END;

  BEGIN
    RETURN (to_timestamp(s, 'FMMM/FMDD/YYYY') AT TIME ZONE 'UTC');
  EXCEPTION WHEN others THEN
  END;

  RETURN NULL;
END;
$$;

-- 3) Trigger: keep create_date in sync with create_date_raw.
CREATE OR REPLACE FUNCTION opportunities_set_create_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.create_date_raw := NULLIF(BTRIM(NEW.create_date_raw), '');
  IF NEW.create_date_raw IS NULL THEN
    NEW.create_date := NULL;
  ELSE
    NEW.create_date := try_parse_timestamptz(NEW.create_date_raw);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='opportunities') THEN
    DROP TRIGGER IF EXISTS opportunities_set_create_date_trg ON opportunities;
    CREATE TRIGGER opportunities_set_create_date_trg
      BEFORE INSERT OR UPDATE OF create_date_raw ON opportunities
      FOR EACH ROW
      EXECUTE FUNCTION opportunities_set_create_date();
  END IF;
END $$;

