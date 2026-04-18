-- Global email templates (SalesForecast.io handoff).
-- If public.email_templates exists but is not the new schema (no template_type), rename it away
-- so CREATE TABLE can own `email_templates`. Do not key off template_key — some DBs never had that column name.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'email_templates'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'email_templates' AND column_name = 'template_type'
  ) THEN
    EXECUTE 'ALTER TABLE public.email_templates RENAME TO email_templates_legacy_20260208';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type text NOT NULL UNIQUE,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO email_templates (template_type, subject, body_html, body_text) VALUES
(
  'admin_welcome',
  'Welcome to SalesForecast.io — Set Up Your Account',
  '<p>Hi {{name}},</p><p>Your admin account for {{org_name}} has been created on SalesForecast.io.</p><p>Click the link below to set your password and access your account. This link expires in 24 hours.</p><p><a href="{{set_password_link}}">Set Your Password</a></p><p>If you did not expect this email, you can ignore it.</p>',
  'Hi {{name}},

Your admin account for {{org_name}} has been created on SalesForecast.io.

Set your password here (link expires in 24 hours):
{{set_password_link}}

If you did not expect this email, you can ignore it.'
),
(
  'user_welcome',
  'You''ve been added to {{org_name}} on SalesForecast.io',
  '<p>Hi {{name}},</p><p>{{org_name}} has added you to SalesForecast.io.</p><p>Click the link below to set your password and access your account. This link expires in 24 hours.</p><p><a href="{{set_password_link}}">Set Your Password</a></p><p>If you did not expect this email, you can ignore it.</p>',
  'Hi {{name}},

{{org_name}} has added you to SalesForecast.io.

Set your password here (link expires in 24 hours):
{{set_password_link}}

If you did not expect this email, you can ignore it.'
),
(
  'password_reset',
  'Reset your SalesForecast.io password',
  '<p>Hi {{name}},</p><p>Click the link below to reset your password. This link expires in 24 hours.</p><p><a href="{{reset_link}}">Reset Password</a></p><p>If you did not request this, you can safely ignore this email. Your password will not change.</p>',
  'Hi {{name}},

Click the link below to reset your password (expires in 24 hours):
{{reset_link}}

If you did not request this, you can safely ignore this email.'
)
ON CONFLICT (template_type) DO NOTHING;
