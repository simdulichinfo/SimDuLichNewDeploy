-- Smart Import legitimately produces rows with no parseable duration (e.g.
-- physical SIM products from the real supplier file that don't specify an
-- exact usage duration). `computeRowPricing`'s `noDurationMultiplier` rule
-- exists specifically to price these rows. Relax the NOT NULL constraint so
-- that feature keeps working; this is additive/safe and never requires a
-- data rewrite since every already-seeded row already has a non-null value.
alter table public.products alter column duration_days drop not null;
