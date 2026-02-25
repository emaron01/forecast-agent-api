-- Cascade delete: when an opportunity is deleted, remove comment_ingestions and opportunity_audit_events.
-- When an organization is deleted, application code deletes in dependency order (see deleteOrganization).
-- This migration ensures opportunity-level children are cleaned when opportunities are deleted.
--
-- Safe to run multiple times (idempotent).

-- 1. Delete orphaned rows (opportunity_id references non-existent opportunities) before adding FK.
DO $$
BEGIN
  IF to_regclass('public.opportunities') IS NOT NULL AND to_regclass('public.comment_ingestions') IS NOT NULL THEN
    DELETE FROM public.comment_ingestions
     WHERE opportunity_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = comment_ingestions.opportunity_id);
  END IF;
  IF to_regclass('public.opportunities') IS NOT NULL AND to_regclass('public.opportunity_audit_events') IS NOT NULL THEN
    DELETE FROM public.opportunity_audit_events
     WHERE opportunity_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opportunity_audit_events.opportunity_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.opportunities') IS NULL OR to_regclass('public.comment_ingestions') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'comment_ingestions' AND c.conname = 'comment_ingestions_opportunity_id_fkey'
  ) THEN
    ALTER TABLE public.comment_ingestions
      ADD CONSTRAINT comment_ingestions_opportunity_id_fkey
      FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.opportunity_audit_events') IS NULL OR to_regclass('public.opportunities') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'opportunity_audit_events' AND c.conname = 'opportunity_audit_events_opportunity_id_fkey'
  ) THEN
    ALTER TABLE public.opportunity_audit_events
      ADD CONSTRAINT opportunity_audit_events_opportunity_id_fkey
      FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;
  END IF;
END;
$$ LANGUAGE plpgsql;
