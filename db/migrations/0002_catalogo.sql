-- 0002 · Catálogo maestro: módulos, planes, familias y tipos de negocio
--
-- Es la fuente de las plantillas. Se carga desde data/catalogo_plantillas_negocios.xlsx
-- con db/tools/generar_seed.py. Los negocios reciben una COPIA; cambiar el catálogo
-- nunca modifica negocios que ya existen.

create table catalogo.plan (
  codigo          text primary key,                        -- gratis, emprendedor, negocio, pro
  nombre          text not null,
  precio_mensual  numeric(10,2) not null check (precio_mensual >= 0),
  orden           smallint not null unique,
  limites         jsonb not null default '{}'::jsonb      -- {"usuarios": 1, "productos": 50}
);

create table catalogo.modulo (
  codigo       text primary key check (codigo ~ '^M[0-9]{2}$'),
  nombre       text not null,
  descripcion  text not null,
  tipo         text not null check (tipo in ('nucleo', 'activable')),
  fase         smallint not null default 1 check (fase between 1 and 3)
);

-- Un módulo que requiere otro para funcionar (variantes requiere inventario, etc.).
create table catalogo.modulo_dependencia (
  modulo   text not null references catalogo.modulo(codigo) on delete cascade,
  requiere text not null references catalogo.modulo(codigo) on delete cascade,
  primary key (modulo, requiere),
  check (modulo <> requiere)
);

-- Qué módulos incluye cada plan.
create table catalogo.plan_modulo (
  plan   text not null references catalogo.plan(codigo) on delete cascade,
  modulo text not null references catalogo.modulo(codigo) on delete cascade,
  primary key (plan, modulo)
);

create table catalogo.familia (
  codigo          text primary key check (codigo ~ '^F[0-9]{2}$'),
  nombre          text not null,
  descripcion     text not null,
  palabra_items   text not null,              -- "Productos", "Platos", "Servicios"
  unidad_defecto  text not null,
  version         integer not null default 1
);

-- S = se activa al registrarse · O = se sugiere después
create table catalogo.familia_modulo (
  familia text not null references catalogo.familia(codigo) on delete cascade,
  modulo  text not null references catalogo.modulo(codigo) on delete cascade,
  modo    char(1) not null check (modo in ('S', 'O')),
  primary key (familia, modulo)
);

-- Texto de búsqueda: nombre + sinónimos, sin tildes y en minúsculas.
-- array_to_string es STABLE en general, pero con text[] el resultado no cambia: se declara IMMUTABLE.
create or replace function catalogo.texto_busqueda(nombre text, sinonimos text[])
returns text
language sql
immutable
parallel safe
as $$
  select catalogo.normalizar(nombre || ' ' || array_to_string(sinonimos, ' '));
$$;

create table catalogo.tipo_negocio (
  id             bigint generated always as identity primary key,
  codigo         text not null unique,                     -- T001…; los creados por IA usan IA0001…
  nombre         text not null,
  familia        text not null references catalogo.familia(codigo),
  sinonimos      text[] not null default '{}',
  categorias     text[] not null default '{}',
  palabra_items  text,                                     -- null = la de la familia
  unidad         text,                                     -- null = la de la familia
  ajuste         text,
  prioridad      smallint not null default 0 check (prioridad between 0 and 5),  -- desempata búsquedas: los tipos más comunes primero
  estado         text not null default 'aprobado' check (estado in ('aprobado', 'pendiente', 'rechazado')),
  origen         text not null default 'manual' check (origen in ('manual', 'ia')),
  version        integer not null default 1,
  busqueda       text generated always as (catalogo.texto_busqueda(nombre, sinonimos)) stored,
  creado_en      timestamptz not null default now()
);

create unique index tipo_negocio_nombre_uq on catalogo.tipo_negocio (catalogo.normalizar(nombre));
create index tipo_negocio_busqueda_trgm on catalogo.tipo_negocio using gin (busqueda gin_trgm_ops);
create index tipo_negocio_familia_idx on catalogo.tipo_negocio (familia);

-- Productos de ejemplo de la ficha. Sin precio: el dueño pone los suyos.
create table catalogo.plantilla_producto (
  id              bigint generated always as identity primary key,
  tipo_negocio_id bigint not null references catalogo.tipo_negocio(id) on delete cascade,
  categoria       text not null,
  nombre          text not null,
  unidad          text not null,
  variantes       text,
  orden           smallint not null default 0,
  unique (tipo_negocio_id, nombre)
);

grant select on all tables in schema catalogo to alcien_app;
