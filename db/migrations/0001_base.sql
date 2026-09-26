-- 0001 · Base: extensiones, esquemas, roles y funciones de ayuda
--
-- Esquemas:
--   catalogo → catálogo maestro (módulos, familias, tipos de negocio, planes). Lo administra Nubegocio.
--   app      → datos de cada negocio. Todas sus tablas llevan negocio_id y seguridad por fila.
--   auth     → códigos de acceso y sesiones.
--
-- Roles:
--   alcien_app → rol con el que se conecta la API. No es dueño de las tablas y NO se salta la seguridad por fila.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists citext;

create schema if not exists catalogo;
create schema if not exists app;
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'alcien_app') then
    create role alcien_app nologin nobypassrls;
  end if;
end $$;

grant usage on schema catalogo, app, auth to alcien_app;

-- unaccent no es IMMUTABLE; esta envoltura sí lo es (diccionario fijo) y permite usarla en índices.
create or replace function catalogo.normalizar(texto text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(public.unaccent('public.unaccent'::regdictionary, coalesce(texto, '')));
$$;

-- Negocio del contexto actual. La API lo fija al inicio de cada transacción:
--   select set_config('app.negocio_id', '<uuid>', true);
create or replace function app.negocio_actual()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.negocio_id', true), '')::uuid;
$$;

grant execute on function catalogo.normalizar(text) to alcien_app;
grant execute on function app.negocio_actual() to alcien_app;
