CREATE SCHEMA IF NOT EXISTS public_registry;
CREATE SCHEMA IF NOT EXISTS operations;
CREATE SCHEMA IF NOT EXISTS evidence;
CREATE SCHEMA IF NOT EXISTS finance;

CREATE TABLE IF NOT EXISTS public_registry.organizations(
  id text PRIMARY KEY,
  name text NOT NULL,
  type text,
  jurisdiction text,
  status text NOT NULL DEFAULT 'PUBLIC_VERIFIED',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_registry.procurement_cases(
  id text PRIMARY KEY,
  owner_id text REFERENCES public_registry.organizations(id),
  number text,
  title text NOT NULL,
  status text,
  phase text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.intake_cases(
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  room_id text,
  organization_id text,
  email text NOT NULL,
  legal_name text NOT NULL,
  government_id text NOT NULL,
  company text NOT NULL,
  role text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'RECEIVED',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.representations(
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  email text NOT NULL,
  legal_name text NOT NULL,
  government_id_hash text NOT NULL,
  government_id_last4 text,
  role text,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence.source_records(
  id bigserial PRIMARY KEY,
  procurement_id text,
  source_url text NOT NULL,
  observed_at timestamptz NOT NULL,
  content_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS finance.pricing_cases(
  id bigserial PRIMARY KEY,
  procurement_id text,
  organization_id text,
  inputs jsonb NOT NULL,
  output jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.payments(
  id bigserial PRIMARY KEY,
  commercial_case_id text,
  provider text,
  provider_reference text,
  amount numeric(14,2),
  currency text DEFAULT 'USD',
  status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
