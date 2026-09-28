-- 0016 · Permisos por empleado (como en Treinta): al cajero o al bodeguero se le activan permisos
--        extra uno por uno. El dueño y el administrador los tienen todos.
--   precios    cambiar precios y dar descuentos al vender
--   anular     anular ventas
--   productos  crear y editar productos, ajustar el stock
--   compras    registrar compras, proveedores, lotes y cotizaciones
--   reportes   ver el balance de otros días, reportes por periodo, costos y descargas
--   gastos     registrar gastos (el bodeguero no puede por defecto)

alter table app.membresia add column permisos text[] not null default '{}'
  check (permisos <@ array['precios', 'anular', 'productos', 'compras', 'reportes', 'gastos']::text[]);

create or replace function app.tiene_permiso(p text)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.rol', true), '') in ('dueno', 'administrador')
      or p = any (string_to_array(coalesce(current_setting('app.permisos', true), ''), ','));
$$;

create or replace function app.entrar_negocio(p_usuario uuid, p_negocio uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, app, auth
as $$
declare
  v_rol text;
  v_permisos text[];
begin
  select m.rol, m.permisos into v_rol, v_permisos
  from app.membresia m
  where m.usuario_id = p_usuario and m.negocio_id = p_negocio and m.activo;

  if v_rol is null then
    raise exception 'El usuario no pertenece a este negocio' using errcode = '42501';
  end if;

  perform set_config('app.negocio_id', p_negocio::text, true);
  perform set_config('app.usuario_id', p_usuario::text, true);
  perform set_config('app.rol', v_rol, true);
  perform set_config('app.permisos', array_to_string(coalesce(v_permisos, '{}'), ','), true);
  return v_rol;
end $$;

create or replace function app.exigir_no_cajero()
returns void
language plpgsql
stable
as $$
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'bodeguero') and not app.tiene_permiso('compras') then
    raise exception 'No tienes permiso para esto' using errcode = '42501';
  end if;
end $$;

create or replace function app.registrar_venta(
  p_items        jsonb,
  p_pagos        jsonb,
  p_cliente      uuid default null,
  p_comprobante  text default 'nota',
  p_nota         text default null
)
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric)
language plpgsql
as $$
declare
  v_negocio   uuid := app.negocio_actual();
  v_usuario   uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
  v_rol       text := coalesce(current_setting('app.rol', true), '');
  v_cfg       app.negocio_config%rowtype;
  v_turno     uuid := app.turno_abierto();
  v_venta     uuid;
  v_numero    bigint;
  v_item      jsonb;
  v_pago      jsonb;
  v_prod      app.producto%rowtype;
  v_cant      numeric;
  v_precio    numeric;
  v_desc      numeric;
  v_tarifa    numeric;
  v_linea     numeric;
  v_base      numeric;
  v_total     numeric := 0;
  v_sub0      numeric := 0;
  v_subg      numeric := 0;
  v_iva       numeric := 0;
  v_descs     numeric := 0;
  v_pagado    numeric := 0;
  v_fiado     numeric := 0;
  v_vuelto    numeric := 0;
  v_metodo    text;
  v_monto     numeric;
  v_recibido  numeric;
  v_saldo     numeric;
  v_limite    numeric;
begin
  if v_negocio is null or v_usuario is null then
    raise exception 'Sin negocio en contexto' using errcode = '42501';
  end if;
  if v_rol not in ('dueno', 'administrador', 'cajero') then
    raise exception 'No tienes permiso para vender' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Demasiadas líneas en una venta' using errcode = '22023';
  end if;
  if jsonb_typeof(p_pagos) is distinct from 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Indica cómo te pagan' using errcode = '22023';
  end if;
  if p_comprobante not in ('nota', 'factura') then
    raise exception 'Comprobante desconocido' using errcode = '22023';
  end if;
  if p_comprobante = 'factura' and not app.modulo_activo('M19') then
    raise exception 'La facturación electrónica no está activa en tu plan' using errcode = '42501';
  end if;

  select * into v_cfg from app.negocio_config where negocio_id = v_negocio;
  if v_cfg.exige_caja_abierta and v_turno is null then
    raise exception 'Abre la caja para empezar a vender' using errcode = '55000';
  end if;

  if p_cliente is not null and not exists (select 1 from app.cliente where id = p_cliente and activo) then
    raise exception 'Cliente no encontrado' using errcode = 'P0002';
  end if;

  v_numero := app.siguiente('venta');
  insert into app.venta (negocio_id, numero, turno_id, cliente_id, vendedor_id, comprobante, total, nota)
  values (v_negocio, v_numero, v_turno, p_cliente, v_usuario, p_comprobante, 0, p_nota)
  returning id into v_venta;

  -- Líneas
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from app.producto
    where id = (v_item->>'producto_id')::uuid and activo
    for update;
    if not found then
      raise exception 'Producto no disponible' using errcode = 'P0002';
    end if;

    v_cant := (v_item->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida para %', v_prod.nombre using errcode = '22023';
    end if;
    if v_cant <> trunc(v_cant) and not app.modulo_activo('M06') then
      raise exception '% se vende por unidades enteras', v_prod.nombre using errcode = '22023';
    end if;

    v_precio := coalesce((v_item->>'precio')::numeric, v_prod.precio);
    if v_precio is null then
      raise exception 'Ponle precio a % antes de venderlo', v_prod.nombre using errcode = '22023';
    end if;
    if v_precio < 0 then
      raise exception 'Precio inválido' using errcode = '22023';
    end if;
    if v_prod.precio is not null and v_precio <> v_prod.precio and v_rol = 'cajero' and not app.tiene_permiso('precios') then
      raise exception 'Solo el dueño o un administrador pueden cambiar precios' using errcode = '42501';
    end if;

    v_desc := round(coalesce((v_item->>'descuento')::numeric, 0), 2);
    v_linea := round(v_cant * v_precio, 2) - v_desc;
    if v_desc < 0 or v_linea < 0 then
      raise exception 'Descuento inválido en %', v_prod.nombre using errcode = '22023';
    end if;
    if v_desc > 0 and v_rol = 'cajero' and not app.tiene_permiso('precios') then
      raise exception 'Solo el dueño o un administrador pueden hacer descuentos' using errcode = '42501';
    end if;

    if v_prod.maneja_stock and not v_cfg.permite_vender_sin_stock and v_prod.stock < v_cant then
      raise exception 'No alcanza el stock de % (quedan %)', v_prod.nombre, v_prod.stock using errcode = '22023';
    end if;

    v_tarifa := coalesce(v_prod.iva, v_cfg.iva_defecto);
    v_base := round(v_linea / (1 + v_tarifa / 100), 2);

    insert into app.venta_detalle (negocio_id, venta_id, producto_id, nombre, cantidad, precio_unitario,
                                   descuento, tarifa_iva, base, iva, total, costo_unitario)
    values (v_negocio, v_venta, v_prod.id, v_prod.nombre, v_cant, v_precio,
            v_desc, v_tarifa, v_base, v_linea - v_base, v_linea, v_prod.costo);

    if v_prod.maneja_stock then
      perform app.mover_stock(v_prod.id, 'venta', -v_cant, v_venta, null, v_prod.costo);
    end if;

    v_total := v_total + v_linea;
    v_descs := v_descs + v_desc;
    v_iva := v_iva + (v_linea - v_base);
    if v_tarifa = 0 then v_sub0 := v_sub0 + v_base; else v_subg := v_subg + v_base; end if;
  end loop;

  -- Pagos
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_metodo := v_pago->>'metodo';
    v_monto := round((v_pago->>'monto')::numeric, 2);
    v_recibido := round((v_pago->>'recibido')::numeric, 2);

    if v_monto is null or v_monto <= 0 then
      raise exception 'Monto de pago inválido' using errcode = '22023';
    end if;
    if v_metodo = 'fiado' then
      if p_cliente is null then
        raise exception 'Para fiar, elige a quién' using errcode = '22023';
      end if;
      if not app.modulo_activo('M14') then
        raise exception 'El fiado no está activo en tu plan' using errcode = '42501';
      end if;
      v_fiado := v_fiado + v_monto;
    elsif v_metodo is null or not (v_metodo = any (v_cfg.metodos_pago)) then
      raise exception 'Método de pago no habilitado: %', coalesce(v_metodo, '(vacío)') using errcode = '22023';
    end if;

    if v_metodo = 'efectivo' then
      v_recibido := coalesce(v_recibido, v_monto);
      if v_recibido < v_monto then
        raise exception 'El efectivo recibido no alcanza' using errcode = '22023';
      end if;
      v_vuelto := v_vuelto + (v_recibido - v_monto);
    else
      v_recibido := null;
    end if;

    insert into app.pago (negocio_id, venta_id, metodo, monto, recibido, vuelto, referencia)
    values (v_negocio, v_venta, v_metodo, v_monto, v_recibido,
            case when v_metodo = 'efectivo' then v_recibido - v_monto else 0 end,
            left(v_pago->>'referencia', 80));
    v_pagado := v_pagado + v_monto;
  end loop;

  if v_pagado <> v_total then
    raise exception 'Los pagos ($ %) no suman el total ($ %)', v_pagado, v_total using errcode = '22023';
  end if;

  -- Fiado: límite de crédito y cargo
  if v_fiado > 0 then
    select saldo, limite_credito into v_saldo, v_limite from app.cliente_saldo where cliente_id = p_cliente;
    if v_limite is not null and v_saldo + v_fiado > v_limite then
      raise exception 'Supera el límite de crédito del cliente ($ %)', v_limite using errcode = '22023';
    end if;
    insert into app.fiado_movimiento (negocio_id, cliente_id, tipo, monto, venta_id, turno_id, creado_por)
    values (v_negocio, p_cliente, 'cargo', v_fiado, v_venta, v_turno, v_usuario);
  end if;

  update app.venta
  set subtotal_0 = v_sub0, subtotal_gravado = v_subg, iva = v_iva, descuento = v_descs, total = v_total
  where id = v_venta;

  return query select v_venta, v_numero, v_total, v_vuelto;
end $$;

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
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') and not app.tiene_permiso('anular') then
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

create or replace function app.ajustar_stock(p_producto uuid, p_nuevo numeric, p_motivo text default 'Conteo')
returns numeric
language plpgsql
as $$
declare
  v_actual numeric;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'bodeguero') and not app.tiene_permiso('productos') then
    raise exception 'No tienes permiso para ajustar el inventario' using errcode = '42501';
  end if;
  if p_nuevo < 0 then
    raise exception 'El stock no puede ser negativo' using errcode = '22023';
  end if;

  select stock into v_actual from app.producto where id = p_producto and maneja_stock for update;
  if not found then
    raise exception 'Producto no encontrado o sin control de stock' using errcode = 'P0002';
  end if;
  if p_nuevo = v_actual then
    return v_actual;
  end if;
  return app.mover_stock(p_producto, 'ajuste', p_nuevo - v_actual, null, p_motivo);
end $$;

create or replace function app.registrar_gasto_v2(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_neg    uuid := app.negocio_actual();
  v_hoy    date := (now() at time zone (select zona_horaria from app.negocio where id = v_neg))::date;
  v_fecha  date := coalesce(nullif(p->>'fecha', '')::date, v_hoy);
  v_metodo text := coalesce(p->>'metodo', 'efectivo');
  v_monto  numeric := round((p->>'monto')::numeric, 2);
  v_turno  uuid;
  v_id     uuid;
begin
  if coalesce(current_setting('app.rol', true), '') = 'bodeguero' and not app.tiene_permiso('gastos') then
    raise exception 'No tienes permiso para registrar gastos' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'categoria'), '') = '' then
    raise exception 'Elige la categoría del gasto' using errcode = '22023';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'Indica el monto del gasto' using errcode = '22023';
  end if;
  if v_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'Forma de pago inválida' using errcode = '22023';
  end if;
  if v_fecha > v_hoy or v_fecha < v_hoy - 366 then
    raise exception 'La fecha del gasto debe ser de este último año' using errcode = '22023';
  end if;
  -- Solo un gasto de hoy en efectivo sale de la caja abierta
  if v_metodo = 'efectivo' and v_fecha = v_hoy then
    v_turno := app.turno_abierto();
  end if;
  insert into app.gasto (negocio_id, turno_id, categoria, descripcion, monto, metodo, fecha, proveedor_id, creado_por)
  values (v_neg, v_turno, trim(p->>'categoria'), nullif(trim(p->>'descripcion'), ''), v_monto, v_metodo, v_fecha,
          nullif(p->>'proveedor_id', '')::uuid, current_setting('app.usuario_id')::uuid)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function app.entrar_negocio(uuid, uuid) from public;
grant execute on function app.entrar_negocio(uuid, uuid) to alcien_app;
grant execute on all functions in schema app to alcien_app;
