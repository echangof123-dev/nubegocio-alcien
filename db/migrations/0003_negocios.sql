-- 0003 · Negocios, usuarios, acceso y datos base de cada negocio

-- ---------- Acceso ----------

create table auth.usuario (
  id          uuid primary key default gen_random_uuid(),
  celular     text not null unique check (celular ~ '^\+[1-9][0-9]{7,14}$'),  -- formato E.164: +5939XXXXXXXX
  nombre      text,
  correo      citext,
  creado_en   timestamptz not null default now()
);

-- Código de acceso de 6 dígitos enviado por WhatsApp. Se guarda solo su hash.
create table auth.codigo_acceso (
  id           uuid primary key default gen_random_uuid(),
  celular      text not null,
  codigo_hash  text not null,
  expira_en    timestamptz not null,
  intentos     smallint not null default 0,
  usado_en     timestamptz,
  creado_en    timestamptz not null default now()
);
create index codigo_acceso_celular_idx on auth.codigo_acceso (celular, creado_en desc);

create table auth.sesion (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references auth.usuario(id) on delete cascade,
  token_hash   text not null unique,
  dispositivo  text,
  expira_en    timestamptz not null,
  revocada_en  timestamptz,
  creado_en    timestamptz not null default now()
);

-- ---------- Negocio ----------

create table app.negocio (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null check (length(trim(nombre)) between 1 and 120),
  tipo_negocio_id    bigint not null references catalogo.tipo_negocio(id),
  familia            text not null references catalogo.familia(codigo),
  version_plantilla  integer not null,
  ruc                text check (ruc is null or ruc ~ '^[0-9]{13}$'),
  razon_social       text,
  regimen            text check (regimen is null or regimen in ('general', 'rimpe_emprendedor', 'rimpe_negocio_popular')),
  zona_horaria       text not null default 'America/Guayaquil',
  creado_por         uuid not null references auth.usuario(id),
  creado_en          timestamptz not null default now()
);

create table app.suscripcion (
  negocio_id  uuid primary key references app.negocio(id) on delete cascade,
  plan        text not null references catalogo.plan(codigo),
  estado      text not null check (estado in ('prueba', 'activa', 'gracia', 'vencida')),
  vence_en    timestamptz not null,
  actualizado_en timestamptz not null default now()
);

create table app.membresia (
  usuario_id  uuid not null references auth.usuario(id) on delete cascade,
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  rol         text not null check (rol in ('dueno', 'administrador', 'cajero', 'bodeguero')),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  primary key (usuario_id, negocio_id)
);
create index membresia_negocio_idx on app.membresia (negocio_id);

-- Módulos del negocio y de dónde vino cada uno.
create table app.negocio_modulo (
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  modulo      text not null references catalogo.modulo(codigo),
  activo      boolean not null,
  origen      text not null check (origen in ('plantilla', 'usuario', 'sugerido', 'dependencia')),
  actualizado_en timestamptz not null default now(),
  primary key (negocio_id, modulo)
);

create table app.negocio_config (
  negocio_id      uuid primary key references app.negocio(id) on delete cascade,
  palabra_items   text not null,
  unidad_defecto  text not null,
  iva_defecto     numeric(5,2) not null default 15 check (iva_defecto >= 0),
  moneda          char(3) not null default 'USD',
  metodos_pago    text[] not null default array['efectivo', 'transferencia', 'tarjeta'],
  permite_vender_sin_stock boolean not null default true,
  exige_caja_abierta       boolean not null default true
);

create table app.categoria (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  nombre      text not null,
  orden       smallint not null default 0,
  creado_en   timestamptz not null default now(),
  unique (negocio_id, nombre)
);

create table app.producto (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references app.negocio(id) on delete cascade,
  categoria_id   uuid references app.categoria(id) on delete set null,
  nombre         text not null,
  unidad         text not null,
  precio         numeric(12,2) check (precio is null or precio >= 0),   -- null = el dueño aún no lo pone
  costo          numeric(12,4) check (costo is null or costo >= 0),
  iva            numeric(5,2),                                          -- null = el del negocio
  codigo_barras  text,
  maneja_stock   boolean not null default true,
  stock_minimo   numeric(12,3),
  variantes      text,
  es_ejemplo     boolean not null default false,                       -- vino de la plantilla y no se ha editado
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (negocio_id, nombre)
);
create index producto_negocio_categoria_idx on app.producto (negocio_id, categoria_id);
create unique index producto_codigo_barras_uq on app.producto (negocio_id, codigo_barras) where codigo_barras is not null;

-- Al editar un producto de ejemplo deja de serlo.
create or replace function app.producto_marcar_editado()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  if old.es_ejemplo and (new.nombre, new.precio, new.unidad) is distinct from (old.nombre, old.precio, old.unidad) then
    new.es_ejemplo := false;
  end if;
  return new;
end $$;

create trigger producto_editado
before update on app.producto
for each row execute function app.producto_marcar_editado();
