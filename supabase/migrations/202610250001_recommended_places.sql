create table if not exists public.recommended_places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  price_range text not null default '',
  real_review text not null default '',
  signature_dishes text not null default '',
  hygiene text not null default '',
  ambience text not null default '',
  suitable_hours text not null default '',
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.recommendation_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.recommended_places enable row level security;
alter table public.recommendation_admins enable row level security;

create or replace function public.is_recommendation_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.recommendation_admins as admins
    where admins.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_recommendation_admin() from public;
grant execute on function public.is_recommendation_admin() to anon, authenticated;
grant select on public.recommended_places to anon, authenticated;
grant insert, update, delete on public.recommended_places to authenticated;
revoke all on public.recommendation_admins from anon, authenticated;

create policy "Anyone can view recommended places"
  on public.recommended_places for select
  to anon, authenticated
  using (true);

create policy "Admins can add recommended places"
  on public.recommended_places for insert
  to authenticated
  with check ((select public.is_recommendation_admin()));

create policy "Admins can update recommended places"
  on public.recommended_places for update
  to authenticated
  using ((select public.is_recommendation_admin()))
  with check ((select public.is_recommendation_admin()));

create policy "Admins can delete recommended places"
  on public.recommended_places for delete
  to authenticated
  using ((select public.is_recommendation_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'locafood-recommendation-photos',
  'locafood-recommendation-photos',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Anyone can view recommended place photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'locafood-recommendation-photos');

create policy "Admins can upload recommended place photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'locafood-recommendation-photos'
    and (select public.is_recommendation_admin())
  );

create policy "Admins can update recommended place photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'locafood-recommendation-photos'
    and (select public.is_recommendation_admin())
  )
  with check (
    bucket_id = 'locafood-recommendation-photos'
    and (select public.is_recommendation_admin())
  );

create policy "Admins can delete recommended place photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'locafood-recommendation-photos'
    and (select public.is_recommendation_admin())
  );