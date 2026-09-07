create table public.categories (
  id serial primary key,
  name text not null,
  slug text not null unique,
  image_url text,
  status text not null default 'active'
);

alter table public.categories enable row level security;

create policy "Anyone can view active categories"
  on public.categories for select
  using (status = 'active');

create table public.category_countries (
  category_id int not null references public.categories(id) on delete cascade,
  country_code text not null,
  primary key (category_id, country_code)
);

create index idx_category_countries_country on public.category_countries(country_code);

alter table public.category_countries enable row level security;

create policy "Anyone can view category countries"
  on public.category_countries for select
  using (true);

create table public.products (
  id bigserial primary key,
  category_id int not null references public.categories(id),
  title text not null,
  slug text not null unique,
  sim_type text not null check (sim_type in ('esim','physical')),
  price_buy numeric(15,2) not null,
  price_import numeric(15,2) not null,
  data_info text not null,
  duration_days int not null,
  package_type text not null check (package_type in ('fixed','daily','unlimited')),
  capacity_bucket text not null check (capacity_bucket in ('under-1gb','1gb','2gb','unlimited','other-fixed')),
  api_package_code text,
  status text not null default 'active'
);

create index idx_products_category on public.products(category_id);
create index idx_products_sim_type_status on public.products(sim_type, status);

alter table public.products enable row level security;

create policy "Anyone can view active products"
  on public.products for select
  using (status = 'active');

create view public.products_public
with (security_invoker = true) as
select p.id, p.category_id, p.title, p.slug, p.sim_type, p.price_buy, p.data_info,
       p.duration_days, p.package_type, p.capacity_bucket, p.status
from public.products p
join public.categories c on c.id = p.category_id
where p.status = 'active' and c.status = 'active';

grant select on public.products_public to anon, authenticated;

create or replace function public.min_price_by_country()
returns table(country_code text, min_price numeric)
language sql
stable
as $$
  select cc.country_code, min(pp.price_buy) as min_price
  from public.category_countries cc
  join public.products_public pp on pp.category_id = cc.category_id
  group by cc.country_code;
$$;

grant execute on function public.min_price_by_country() to anon, authenticated;
