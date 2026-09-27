-- 0009 · Facturación electrónica del SRI (esquema offline)
--
-- Cada negocio factura con SU propio RUC y SU firma electrónica. La firma (.p12) y su clave
-- llegan cifradas desde la API (AES-256-GCM con una clave que vive en Secret Manager):
-- la base nunca ve la firma en claro.
--
-- Ciclo de un comprobante:
--   por_firmar → firmado → recibido → autorizado
--                    ↘ devuelto (el SRI lo rechazó al recibirlo: no existe para el SRI)
--                               ↘ no_autorizado
--   Un comprobante que el SRI no conoce (por_firmar, firmado, devuelto, no_autorizado) se puede
--   marcar "anulado" sin más. Una factura autorizada solo se anula con una nota de crédito.

alter table app.cliente add column direccion text check (direccion is null or length(direccion) <= 300);

-- ---------- Datos de facturación del negocio ----------

create table app.sri_config (
  negocio_id              uuid primary key references app.negocio(id) on delete cascade,
  ruc                     text not null check (ruc ~ '^[0-9]{10}001$'),
  razon_social            text not null check (length(trim(razon_social)) between 3 and 300),
  nombre_comercial        text check (nombre_comercial is null or length(nombre_comercial) <= 300),
  dir_matriz              text not null check (length(trim(dir_matriz)) between 3 and 300),
  dir_establecimiento     text not null check (length(trim(dir_establecimiento)) between 3 and 300),
  estab                   text not null default '001' check (estab ~ '^[0-9]{3}$' and estab <> '000'),
  pto_emi                 text not null default '001' check (pto_emi ~ '^[0-9]{3}$' and pto_emi <> '000'),
  obligado_contabilidad   boolean not null default false,
  contribuyente_especial  text check (contribuyente_especial is null or contribuyente_especial ~ '^[0-9]{1,13}$'),
  agente_retencion        text check (agente_retencion is null or agente_retencion ~ '^[0-9]{1,8}$'),
  regimen                 text not null default 'general'
                          check (regimen in ('general', 'rimpe_emprendedor', 'rimpe_popular')),
  ambiente                smallint not null default 1 check (ambiente in (1, 2)),   -- 1 pruebas, 2 producción
  -- Firma electrónica (cifrada por la API)
  firma_cifrada           bytea,
  clave_firma_cifrada     bytea,
  firma_titular           text,
  firma_emisor            text,
  firma_serie             text,
  firma_vence             timestamptz,
  actualizado_en          timestamptz not null default now(),
  check ((firma_cifrada is null) = (clave_firma_cifrada is null))
);

-- ---------- Comprobantes ----------

create table app.comprobante (
  id                   uuid primary key default gen_random_uuid(),
  negocio_id           uuid not null references app.negocio(id) on delete cascade,
  venta_id             uuid not null references app.venta(id),
  tipo                 text not null check (tipo in ('factura', 'nota_credito')),
  cod_doc              text not null check (cod_doc in ('01', '04')),
  ambiente             smallint not null check (ambiente in (1, 2)),
  estab                text not null,
  pto_emi              text not null,
  secuencial           bigint not null check (secuencial between 1 and 999999999),
  numero               text generated always as (estab || '-' || pto_emi || '-' || lpad(secuencial::text, 9, '0')) stored,
  clave_acceso         text not null unique check (clave_acceso ~ '^[0-9]{49}$'),
  fecha_emision        date not null,
  comprador            jsonb not null,
  total                numeric(12,2) not null,
  doc_modificado_id    uuid references app.comprobante(id),
  motivo               text,
  xml_firmado          text,
  estado               text not null default 'por_firmar'
                       check (estado in ('por_firmar', 'firmado', 'recibido', 'autorizado',
                                         'devuelto', 'no_autorizado', 'anulado')),
  mensajes             jsonb not null default '[]',
  numero_autorizacion  text,
  fecha_autorizacion   timestamptz,
  intentos             integer not null default 0,
  enviando_desde       timestamptz,
  proximo_intento      timestamptz not null default now(),
  token_publico        text not null unique default encode(gen_random_bytes(18), 'hex'),
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  unique (negocio_id, ambiente, cod_doc, estab, pto_emi, secuencial),
  check ((tipo = 'factura') = (cod_doc = '01')),
  check ((tipo = 'nota_credito') = (doc_modificado_id is not null and motivo is not null)),
  check (estado in ('por_firmar', 'anulado') or xml_firmado is not null),
  check ((estado = 'autorizado') = (numero_autorizacion is not null))
);
create index comprobante_negocio_fecha_idx on app.comprobante (negocio_id, creado_en desc);
create index comprobante_venta_idx on app.comprobante (venta_id);
create index comprobante_pendiente_idx on app.comprobante (proximo_intento) where estado in ('firmado', 'recibido');

-- ---------- Clave de acceso (49 dígitos, ficha técnica del SRI) ----------

-- Dígito verificador módulo 11 con pesos 2..7 de derecha a izquierda.
create or replace function app.modulo11(p_digitos text)
returns integer
language plpgsql
immutable strict
as $$
declare
  s int := 0;
  peso int := 2;
  i int;
  dv int;
begin
  for i in reverse length(p_digitos)..1 loop
    s := s + substr(p_digitos, i, 1)::int * peso;
    peso := case when peso = 7 then 2 else peso + 1 end;
  end loop;
  dv := 11 - (s % 11);
  return case dv when 11 then 0 when 10 then 1 else dv end;
end $$;

create or replace function app.clave_acceso(
  p_fecha date, p_cod_doc text, p_ruc text, p_ambiente int,
  p_estab text, p_pto_emi text, p_secuencial bigint, p_codigo_numerico text)
returns text
language sql
immutable strict
as $$
  select b || app.modulo11(b)
  from (select to_char(p_fecha, 'DDMMYYYY') || p_cod_doc || p_ruc || p_ambiente::text
               || p_estab || p_pto_emi || lpad(p_secuencial::text, 9, '0')
               || p_codigo_numerico || '1' as b) x;   -- tipo de emisión 1 = normal
$$;

-- ---------- Configuración ----------

create or replace function app.exigir_dueno_o_admin()
returns void
language plpgsql
stable
as $$
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador pueden configurar la facturación' using errcode = '42501';
  end if;
end $$;

-- p: {ruc, razon_social, nombre_comercial, dir_matriz, dir_establecimiento, estab, pto_emi,
--     obligado_contabilidad, contribuyente_especial, agente_retencion, regimen, ambiente,
--     siguiente_factura, siguiente_nota_credito}
create or replace function app.sri_guardar_datos(p jsonb)
returns void
language plpgsql
as $$
declare
  v_neg uuid := app.negocio_actual();
  v_cfg app.sri_config%rowtype;
  v_n   bigint;
  v_cod text;
begin
  perform app.exigir_dueno_o_admin();

  insert into app.sri_config as c (negocio_id, ruc, razon_social, nombre_comercial, dir_matriz, dir_establecimiento,
                              estab, pto_emi, obligado_contabilidad, contribuyente_especial, agente_retencion,
                              regimen, ambiente)
  values (v_neg, p->>'ruc', trim(p->>'razon_social'), nullif(trim(p->>'nombre_comercial'), ''),
          trim(p->>'dir_matriz'), trim(p->>'dir_establecimiento'),
          coalesce(p->>'estab', '001'), coalesce(p->>'pto_emi', '001'),
          coalesce((p->>'obligado_contabilidad')::boolean, false),
          nullif(p->>'contribuyente_especial', ''), nullif(p->>'agente_retencion', ''),
          coalesce(p->>'regimen', 'general'), coalesce((p->>'ambiente')::smallint, 1))
  on conflict (negocio_id) do update set
    ruc = excluded.ruc, razon_social = excluded.razon_social, nombre_comercial = excluded.nombre_comercial,
    dir_matriz = excluded.dir_matriz, dir_establecimiento = excluded.dir_establecimiento,
    estab = excluded.estab, pto_emi = excluded.pto_emi, obligado_contabilidad = excluded.obligado_contabilidad,
    contribuyente_especial = excluded.contribuyente_especial, agente_retencion = excluded.agente_retencion,
    regimen = excluded.regimen, ambiente = excluded.ambiente, actualizado_en = now()
  returning * into v_cfg;

  -- Si el negocio ya facturaba con otro sistema, continúa su numeración (nunca retrocede)
  foreach v_cod in array array['01', '04'] loop
    v_n := nullif(p->>case v_cod when '01' then 'siguiente_factura' else 'siguiente_nota_credito' end, '')::bigint;
    if v_n is not null then
      if v_n < 1 or v_n > 999999999 then
        raise exception 'El número siguiente debe estar entre 1 y 999999999' using errcode = '22023';
      end if;
      insert into app.contador (negocio_id, clave, valor)
      values (v_neg, app.sri_clave_contador(v_cfg.ambiente, v_cod, v_cfg.estab, v_cfg.pto_emi), v_n - 1)
      on conflict (negocio_id, clave) do update set valor = greatest(app.contador.valor, excluded.valor);
    end if;
  end loop;
end $$;

create or replace function app.sri_clave_contador(p_ambiente int, p_cod text, p_estab text, p_pto text)
returns text
language sql
immutable
as $$ select 'sri:' || p_ambiente || ':' || p_cod || ':' || p_estab || '-' || p_pto $$;

create or replace function app.sri_guardar_firma(
  p_firma bytea, p_clave bytea, p_titular text, p_emisor text, p_serie text, p_vence timestamptz)
returns void
language plpgsql
as $$
begin
  perform app.exigir_dueno_o_admin();
  update app.sri_config
  set firma_cifrada = p_firma, clave_firma_cifrada = p_clave, firma_titular = p_titular,
      firma_emisor = p_emisor, firma_serie = p_serie, firma_vence = p_vence, actualizado_en = now()
  where negocio_id = app.negocio_actual();
  if not found then
    raise exception 'Primero guarda los datos de facturación' using errcode = '22023';
  end if;
end $$;

-- ---------- Emitir ----------

-- Reserva el número y la clave de acceso de un comprobante. La API arma el XML, lo firma y lo
-- guarda con app.sri_guardar_firmado en la misma transacción.
create or replace function app.sri_reservar(p_venta uuid, p_tipo text, p_doc_modificado uuid default null, p_motivo text default null)
returns app.comprobante
language plpgsql
as $$
declare
  v_neg   uuid := app.negocio_actual();
  v_cfg   app.sri_config%rowtype;
  v_venta app.venta%rowtype;
  v_cli   app.cliente%rowtype;
  v_cod   text := case p_tipo when 'factura' then '01' when 'nota_credito' then '04' end;
  v_fecha date;
  v_sec   bigint;
  v_comp  jsonb;
  v_mod   app.comprobante%rowtype;
  r       app.comprobante%rowtype;
begin
  if v_cod is null then
    raise exception 'Tipo de comprobante inválido' using errcode = '22023';
  end if;
  if not app.modulo_activo('M19') then
    raise exception 'La facturación electrónica no está activa en tu plan' using errcode = '42501';
  end if;

  select * into v_cfg from app.sri_config where negocio_id = v_neg;
  if not found or v_cfg.firma_cifrada is null then
    raise exception 'Configura la facturación electrónica (datos y firma) antes de facturar' using errcode = '55000';
  end if;
  if v_cfg.firma_vence is not null and v_cfg.firma_vence < now() then
    raise exception 'Tu firma electrónica venció el %. Sube la nueva para seguir facturando',
      to_char(v_cfg.firma_vence, 'DD/MM/YYYY') using errcode = '55000';
  end if;

  select * into v_venta from app.venta where id = p_venta;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if v_venta.total <= 0 then
    raise exception 'No se puede facturar una venta en $0' using errcode = '22023';
  end if;

  -- Comprador
  if v_venta.cliente_id is not null then
    select * into v_cli from app.cliente where id = v_venta.cliente_id;
  end if;
  if v_cli.identificacion is null then
    if v_venta.total > 50 then
      raise exception 'Las facturas de más de $50 necesitan la cédula o RUC del cliente' using errcode = '22023';
    end if;
    v_comp := jsonb_build_object('tipo_identificacion', '07', 'identificacion', '9999999999999',
                                 'razon_social', 'CONSUMIDOR FINAL');
  else
    v_comp := jsonb_strip_nulls(jsonb_build_object(
      'tipo_identificacion', case v_cli.tipo_identificacion when 'ruc' then '04' when 'cedula' then '05' else '06' end,
      'identificacion', v_cli.identificacion,
      'razon_social', v_cli.nombre,
      'direccion', v_cli.direccion,
      'correo', v_cli.correo::text,
      'telefono', v_cli.celular));
  end if;

  if p_tipo = 'nota_credito' then
    select * into v_mod from app.comprobante where id = p_doc_modificado and venta_id = p_venta and tipo = 'factura';
    if not found or v_mod.estado <> 'autorizado' then
      raise exception 'La nota de crédito necesita una factura autorizada' using errcode = '22023';
    end if;
    if coalesce(trim(p_motivo), '') = '' then
      raise exception 'Escribe el motivo de la nota de crédito' using errcode = '22023';
    end if;
    if v_mod.comprador->>'tipo_identificacion' = '07' then
      raise exception 'El SRI no permite notas de crédito a consumidor final' using errcode = '22023';
    end if;
    if v_mod.fecha_emision < current_date - interval '12 months' then
      raise exception 'La factura tiene más de 12 meses: ya no admite nota de crédito' using errcode = '22023';
    end if;
    v_comp := v_mod.comprador;   -- el mismo comprador de la factura
  else
    if v_venta.estado = 'anulada' then
      raise exception 'La venta está anulada' using errcode = '22023';
    end if;
    if exists (select 1 from app.comprobante where venta_id = p_venta and tipo = 'factura' and estado <> 'anulado') then
      raise exception 'Esta venta ya tiene factura' using errcode = '22023';
    end if;
    -- Una venta hecha con nota también se puede facturar después (el cliente pidió factura)
    update app.venta set comprobante = 'factura' where id = p_venta and comprobante <> 'factura';
  end if;

  select (now() at time zone n.zona_horaria)::date into v_fecha from app.negocio n where n.id = v_neg;
  v_sec := app.siguiente(app.sri_clave_contador(v_cfg.ambiente, v_cod, v_cfg.estab, v_cfg.pto_emi));
  if v_sec > 999999999 then
    raise exception 'Se agotó la numeración del punto de emisión %-%', v_cfg.estab, v_cfg.pto_emi using errcode = '55000';
  end if;

  insert into app.comprobante (negocio_id, venta_id, tipo, cod_doc, ambiente, estab, pto_emi, secuencial,
                               clave_acceso, fecha_emision, comprador, total, doc_modificado_id, motivo)
  values (v_neg, p_venta, p_tipo, v_cod, v_cfg.ambiente, v_cfg.estab, v_cfg.pto_emi, v_sec,
          app.clave_acceso(v_fecha, v_cod, v_cfg.ruc, v_cfg.ambiente, v_cfg.estab, v_cfg.pto_emi, v_sec,
                           lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 100000000)::text, 8, '0')),
          v_fecha, v_comp, v_venta.total, p_doc_modificado, nullif(trim(p_motivo), ''))
  returning * into r;
  return r;
end $$;

create or replace function app.sri_guardar_firmado(p_id uuid, p_xml text)
returns void
language plpgsql
as $$
begin
  update app.comprobante set xml_firmado = p_xml, estado = 'firmado', actualizado_en = now()
  where id = p_id and estado = 'por_firmar';
  if not found then
    raise exception 'El comprobante no está pendiente de firma' using errcode = '55000';
  end if;
end $$;

-- Una venta con factura: la factura que el SRI no conoce se anula sin más; una autorizada
-- necesita nota de crédito (se reserva aquí y la API la firma en la misma transacción).
create or replace function app.anular_venta(p_venta uuid, p_motivo text)
returns void
language plpgsql
as $$
declare
  v_venta app.venta%rowtype;
  v_det   record;
  v_fiado numeric;
  v_fac   app.comprobante%rowtype;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador pueden anular ventas' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023';
  end if;

  select * into v_venta from app.venta where id = p_venta for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if v_venta.estado = 'anulada' then
    raise exception 'La venta ya estaba anulada' using errcode = '22023';
  end if;

  if v_venta.comprobante = 'factura' then
    select * into v_fac from app.comprobante
    where venta_id = p_venta and tipo = 'factura' and estado <> 'anulado'
    order by creado_en desc limit 1
    for update;
    if found then
      if v_fac.estado = 'recibido' or v_fac.enviando_desde > now() - interval '2 minutes' then
        raise exception 'El SRI todavía está procesando la factura %. Intenta en unos minutos', v_fac.numero
          using errcode = '55000';
      elsif v_fac.estado = 'autorizado' and v_fac.comprador->>'tipo_identificacion' = '07' then
        -- Resolución NAC-DGERCGC25-00000014: desde 2026 una factura a consumidor final
        -- transmitida al SRI no se anula ni admite nota de crédito.
        raise exception 'La factura % es a consumidor final: el SRI no permite anularla ni emitirle nota de crédito', v_fac.numero
          using errcode = '55000';
      elsif v_fac.estado = 'autorizado' then
        perform app.sri_reservar(p_venta, 'nota_credito', v_fac.id, p_motivo);
      else
        update app.comprobante set estado = 'anulado', actualizado_en = now() where id = v_fac.id;
      end if;
    end if;
  end if;

  for v_det in
    select d.producto_id, d.cantidad, p.maneja_stock
    from app.venta_detalle d join app.producto p on p.id = d.producto_id
    where d.venta_id = p_venta
  loop
    if v_det.maneja_stock then
      perform app.mover_stock(v_det.producto_id, 'anulacion', v_det.cantidad, p_venta, p_motivo);
    end if;
  end loop;

  select sum(monto) into v_fiado from app.fiado_movimiento where venta_id = p_venta and tipo = 'cargo';
  if coalesce(v_fiado, 0) <> 0 then
    insert into app.fiado_movimiento (negocio_id, cliente_id, tipo, monto, venta_id, creado_por)
    values (v_venta.negocio_id, v_venta.cliente_id, 'cargo', -v_fiado, p_venta,
            nullif(current_setting('app.usuario_id', true), '')::uuid);
  end if;

  update app.venta
  set estado = 'anulada', anulada_en = now(), motivo_anulacion = trim(p_motivo),
      anulada_por = nullif(current_setting('app.usuario_id', true), '')::uuid
  where id = p_venta;
end $$;

-- Una factura devuelta o no autorizada se puede volver a emitir (nuevo número) tras corregir los datos.
create or replace function app.sri_reemitir(p_comprobante uuid)
returns app.comprobante
language plpgsql
as $$
declare
  v app.comprobante%rowtype;
begin
  select * into v from app.comprobante where id = p_comprobante for update;
  if not found then
    raise exception 'Comprobante no encontrado' using errcode = 'P0002';
  end if;
  if v.tipo <> 'factura' or v.estado not in ('devuelto', 'no_autorizado') then
    raise exception 'Solo se vuelve a emitir una factura devuelta o no autorizada' using errcode = '55000';
  end if;
  if (select estado from app.venta where id = v.venta_id) = 'anulada' then
    raise exception 'La venta está anulada' using errcode = '55000';
  end if;
  update app.comprobante set estado = 'anulado', actualizado_en = now() where id = v.id;
  return app.sri_reservar(v.venta_id, 'factura');
end $$;

-- Pide reenviar ya (sin esperar al próximo intento programado)
create or replace function app.sri_reintentar(p_comprobante uuid)
returns void
language plpgsql
as $$
begin
  update app.comprobante set proximo_intento = now(), actualizado_en = now()
  where id = p_comprobante and estado in ('firmado', 'recibido');
  if not found then
    raise exception 'Ese comprobante no está pendiente de envío' using errcode = '55000';
  end if;
end $$;

-- ---------- Envío al SRI (proceso en segundo plano, fuera de un negocio) ----------
-- SECURITY DEFINER: recorren todos los negocios, pero solo tocan las columnas de envío.

create or replace function app.sri_tomar_pendientes(p_limite integer default 20, p_id uuid default null)
returns table (id uuid, negocio_id uuid, estado text, ambiente smallint, clave_acceso text, xml_firmado text)
language sql
security definer
set search_path = pg_catalog, app
as $$
  update app.comprobante c
  set enviando_desde = now(), intentos = c.intentos + 1
  where c.id in (
    select x.id from app.comprobante x
    where x.estado in ('firmado', 'recibido')
      and (p_id is null and x.proximo_intento <= now() or x.id = p_id)
      and (x.enviando_desde is null or x.enviando_desde < now() - interval '2 minutes')
    order by x.proximo_intento
    limit greatest(1, least(coalesce(p_limite, 20), 200))
    for update skip locked)
  returning c.id, c.negocio_id, c.estado, c.ambiente, c.clave_acceso, c.xml_firmado;
$$;

-- p_estado: 'firmado' (falló la conexión: se reintenta), 'recibido', 'autorizado', 'devuelto', 'no_autorizado'
create or replace function app.sri_registrar_resultado(
  p_id uuid, p_estado text, p_mensajes jsonb default '[]',
  p_numero_autorizacion text default null, p_fecha_autorizacion timestamptz default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  v app.comprobante%rowtype;
begin
  if p_estado not in ('firmado', 'recibido', 'autorizado', 'devuelto', 'no_autorizado') then
    raise exception 'Estado inválido: %', p_estado using errcode = '22023';
  end if;
  select * into v from app.comprobante where id = p_id for update;
  if not found then
    return;
  end if;
  -- Si alguien lo anuló mientras se enviaba y el SRI igual lo autorizó, manda la autorización:
  -- queda autorizado y el dueño verá que debe emitir la nota de crédito.
  if v.estado = 'anulado' and p_estado <> 'autorizado' then
    update app.comprobante set enviando_desde = null where id = p_id;
    return;
  end if;
  update app.comprobante
  set estado = p_estado,
      mensajes = coalesce(p_mensajes, '[]'),
      numero_autorizacion = case when p_estado = 'autorizado' then coalesce(p_numero_autorizacion, clave_acceso) end,
      fecha_autorizacion = case when p_estado = 'autorizado' then coalesce(p_fecha_autorizacion, now()) end,
      enviando_desde = null,
      -- Espera creciente: 1, 2, 4… minutos, máximo 6 horas
      proximo_intento = case when p_estado in ('firmado', 'recibido')
                             then now() + least(interval '6 hours', interval '1 minute' * power(2, least(intentos - 1, 12)))
                             else proximo_intento end,
      actualizado_en = now()
  where id = p_id;
end $$;

-- Datos para el RIDE público (el enlace que se comparte con el cliente)
create or replace function app.sri_publico(p_token text)
returns table (tipo text, numero text, estado text, ambiente smallint, clave_acceso text, xml_firmado text,
               numero_autorizacion text, fecha_autorizacion timestamptz, regimen text, anulado_por_nc boolean)
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select c.tipo, c.numero, c.estado, c.ambiente, c.clave_acceso, c.xml_firmado,
         c.numero_autorizacion, c.fecha_autorizacion, s.regimen,
         exists (select 1 from app.comprobante nc where nc.doc_modificado_id = c.id and nc.estado = 'autorizado')
  from app.comprobante c
  join app.sri_config s on s.negocio_id = c.negocio_id
  where c.token_publico = p_token and length(p_token) = 36 and c.xml_firmado is not null;
$$;

-- ---------- Seguridad ----------

alter table app.sri_config enable row level security;
alter table app.comprobante enable row level security;
create policy aislamiento_negocio on app.sri_config
  using (negocio_id = app.negocio_actual()) with check (negocio_id = app.negocio_actual());
create policy aislamiento_negocio on app.comprobante
  using (negocio_id = app.negocio_actual()) with check (negocio_id = app.negocio_actual());

grant select, insert, update on app.sri_config, app.comprobante to alcien_app;

revoke all on function app.sri_tomar_pendientes(integer, uuid), app.sri_registrar_resultado(uuid, text, jsonb, text, timestamptz),
                       app.sri_publico(text) from public;
grant execute on all functions in schema app to alcien_app;
