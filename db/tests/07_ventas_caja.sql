-- Etapa 2: vender, cobrar, fiar, anular y cuadrar la caja.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-0000000000e1', '+593990000051'),   -- dueña
  ('00000000-0000-0000-0000-0000000000e2', '+593990000052'),   -- cajero
  ('00000000-0000-0000-0000-0000000000e3', '+593990000053');   -- dueño de otra tienda

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;

insert into ids values ('tienda', app.crear_negocio('00000000-0000-0000-0000-0000000000e1', 'T045', 'Tienda E'));
insert into ids values ('ropa', app.crear_negocio('00000000-0000-0000-0000-0000000000e1', 'T061', 'Ropa E'));
insert into ids values ('otra', app.crear_negocio('00000000-0000-0000-0000-0000000000e3', 'T045', 'Otra tienda'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-0000000000e2', id, 'cajero' from ids where clave = 'tienda';

create function pg_temp.prod(n text) returns uuid language sql as $$ select id from app.producto where nombre = n $$;
create function pg_temp.dueña() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000e1', (select id from ids where clave = 'tienda'));
$$;
create function pg_temp.cajero() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000e2', (select id from ids where clave = 'tienda'));
$$;
grant execute on function pg_temp.prod(text), pg_temp.dueña(), pg_temp.cajero() to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;


-- ---------- La dueña pone precios y abre la caja ----------
do $$
declare
  r record;
begin
  perform pg_temp.dueña();
  update app.producto set precio = 1.35, costo = 1.00 where nombre = 'Arroz 1 kg';
  update app.producto set precio = 1.00 where nombre = 'Leche 1 L';
  update app.producto set precio = 0.15 where nombre = 'Pan';
  update app.producto set precio = 3.00 where nombre = 'Queso fresco';
  perform app.ajustar_stock(pg_temp.prod('Arroz 1 kg'), 10, 'Conteo inicial');
  assert (select stock from app.producto where nombre = 'Arroz 1 kg') = 10, 'stock inicial';

  -- Vender sin caja abierta falla
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Pan'), 'cantidad', 1)),
      '[{"metodo":"efectivo","monto":0.15}]');
    assert false, 'sin caja abierta no se vende';
  exception when object_not_in_prerequisite_state then null;
  end;

  insert into ids values ('turno', app.abrir_caja(20));
  begin
    perform app.abrir_caja(5);
    assert false, 'no se abren dos cajas';
  exception when unique_violation then null;
  end;
end $$;

-- ---------- El cajero vende ----------
do $$
declare
  r record;
  v record;
begin
  perform pg_temp.cajero();

  -- Arroz 1,35 + 2 leches 2,00 + 4 panes 0,60 = 3,95; paga con 5 → vuelto 1,05
  select * into r from app.registrar_venta(
    jsonb_build_array(
      jsonb_build_object('producto_id', pg_temp.prod('Arroz 1 kg'), 'cantidad', 1),
      jsonb_build_object('producto_id', pg_temp.prod('Leche 1 L'), 'cantidad', 2),
      jsonb_build_object('producto_id', pg_temp.prod('Pan'), 'cantidad', 4)),
    '[{"metodo":"efectivo","monto":3.95,"recibido":5}]');
  insert into ids values ('venta1', r.venta_id);

  assert r.numero = 1, 'primera venta = número 1';
  assert r.total = 3.95, format('total 3,95 (salió %s)', r.total);
  assert r.vuelto = 1.05, format('vuelto 1,05 (salió %s)', r.vuelto);

  select * into v from app.venta where id = r.venta_id;
  -- IVA 15 % incluido: 1,35→1,17+0,18 · 2,00→1,74+0,26 · 0,60→0,52+0,08
  assert v.iva = 0.52, format('IVA 0,52 (salió %s)', v.iva);
  assert v.subtotal_gravado = 3.43, format('base 3,43 (salió %s)', v.subtotal_gravado);
  assert v.turno_id = (select id from ids where clave = 'turno'), 'venta en el turno abierto';
  assert (select stock from app.producto where nombre = 'Arroz 1 kg') = 9, 'el stock baja';
  assert (select costo_unitario from app.venta_detalle where venta_id = r.venta_id and nombre = 'Arroz 1 kg') = 1.00,
    'el costo queda guardado para calcular utilidad';

  -- Venta por peso: 0,5 libras de queso
  select * into r from app.registrar_venta(
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Queso fresco'), 'cantidad', 0.5)),
    '[{"metodo":"transferencia","monto":1.50,"referencia":"Pichincha 123"}]');
  assert r.total = 1.50 and r.numero = 2, 'medio queso 1,50';

  -- El cajero no cambia precios ni da descuentos
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Pan'), 'cantidad', 1, 'precio', 0.10)),
      '[{"metodo":"efectivo","monto":0.10}]');
    assert false, 'cajero no cambia precios';
  exception when insufficient_privilege then null;
  end;

  -- Los pagos deben sumar el total
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Pan'), 'cantidad', 2)),
      '[{"metodo":"efectivo","monto":0.20}]');
    assert false, 'pagos que no suman';
  exception when invalid_parameter_value then null;
  end;

  -- Efectivo insuficiente
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Pan'), 'cantidad', 2)),
      '[{"metodo":"efectivo","monto":0.30,"recibido":0.25}]');
    assert false, 'recibido menor al monto';
  exception when invalid_parameter_value then null;
  end;

  -- Producto sin precio
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Azúcar 1 kg'), 'cantidad', 1)),
      '[{"metodo":"efectivo","monto":1}]');
    assert false, 'producto sin precio';
  exception when invalid_parameter_value then null;
  end;

  -- Fiado sin cliente
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Pan'), 'cantidad', 1)),
      '[{"metodo":"fiado","monto":0.15}]');
    assert false, 'fiado sin cliente';
  exception when invalid_parameter_value then null;
  end;

  -- Método no habilitado
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Pan'), 'cantidad', 1)),
      '[{"metodo":"deuna","monto":0.15}]');
    assert false, 'DeUna no está habilitado por defecto';
  exception when invalid_parameter_value then null;
  end;

  -- La venta que falló no dejó rastro (ni número, ni stock)
  assert (select count(*) from app.venta) = 2, 'solo dos ventas';
  assert (select stock from app.producto where nombre = 'Arroz 1 kg') = 9, 'stock intacto tras errores';
end $$;

-- ---------- Fiado, abono, gasto y retiro ----------
do $$
declare
  v_cliente uuid;
  r record;
begin
  perform pg_temp.cajero();
  insert into app.cliente (negocio_id, nombre, celular, limite_credito)
  values (app.negocio_actual(), 'Juan Pérez', '+593990000099', 10)
  returning id into v_cliente;
  insert into ids values ('juan', v_cliente);

  -- Fía 3 quesos = 9,00
  select * into r from app.registrar_venta(
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Queso fresco'), 'cantidad', 3)),
    '[{"metodo":"fiado","monto":9}]', v_cliente);
  insert into ids values ('venta_fiada', r.venta_id);
  assert (select saldo from app.cliente_saldo where cliente_id = v_cliente) = 9, 'Juan debe 9';

  -- Supera el límite de 10
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Leche 1 L'), 'cantidad', 2)),
      '[{"metodo":"fiado","monto":2}]', v_cliente);
    assert false, 'límite de crédito';
  exception when invalid_parameter_value then null;
  end;

  -- Abona 4 en efectivo
  assert app.registrar_abono(v_cliente, 4, 'efectivo') = 5, 'queda debiendo 5';
  begin
    perform app.registrar_abono(v_cliente, 6, 'efectivo');
    assert false, 'no abona más de lo que debe';
  exception when invalid_parameter_value then null;
  end;

  perform app.registrar_gasto('Transporte', 1.50, 'efectivo', 'Flete de bebidas');
  perform app.registrar_gasto('Internet', 25, 'transferencia');
  perform app.movimiento_caja('retiro', 5, 'Depósito en banco');
end $$;

-- ---------- La dueña anula una venta ----------
do $$
begin
  perform pg_temp.cajero();
  begin
    perform app.anular_venta((select id from ids where clave = 'venta1'), 'Error');
    assert false, 'el cajero no anula';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.dueña();
  perform app.anular_venta((select id from ids where clave = 'venta_fiada'), 'Devolvió el queso');
  assert (select estado from app.venta where id = (select id from ids where clave = 'venta_fiada')) = 'anulada', 'anulada';
  -- Debía 9, abonó 4 → saldo 5; al anular los 9 fiados queda a favor -4
  assert (select saldo from app.cliente_saldo where cliente_id = (select id from ids where clave = 'juan')) = -4,
    'la anulación revierte el fiado';
  begin
    perform app.anular_venta((select id from ids where clave = 'venta_fiada'), 'Otra vez');
    assert false, 'no se anula dos veces';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---------- Cierre de caja ----------
do $$
declare
  c record;
begin
  perform pg_temp.cajero();
  select * into c from app.resumen_caja();
  -- apertura 20 + ventas en efectivo 3,95 + abono 4 − retiro 5 − gasto 1,50 = 21,45
  assert c.ventas_cantidad = 2, format('2 ventas completadas (salió %s)', c.ventas_cantidad);
  assert c.ventas_total = 5.45, format('ventas 5,45 (salió %s)', c.ventas_total);
  assert c.efectivo_ventas = 3.95 and c.transferencia = 1.50 and c.fiado = 0, 'desglose por método';
  assert c.efectivo_esperado = 21.45, format('esperado 21,45 (salió %s)', c.efectivo_esperado);

  assert app.cerrar_caja(21.00, 'Faltan monedas') = -0.45, 'faltan 0,45';
  select * into c from app.resumen_caja((select id from ids where clave = 'turno'));
  assert c.estado = 'cerrado' and c.diferencia = -0.45 and c.efectivo_contado = 21.00, 'cierre guardado';

  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Pan'), 'cantidad', 1)),
      '[{"metodo":"efectivo","monto":0.15}]');
    assert false, 'con la caja cerrada no se vende';
  exception when object_not_in_prerequisite_state then null;
  end;

  assert (select ventas from app.resumen_hoy()) = 2, 'resumen del día';
end $$;

-- ---------- Otra tienda no ve nada de esto ----------
do $$
begin
  perform app.entrar_negocio('00000000-0000-0000-0000-0000000000e3', (select id from ids where clave = 'otra'));
  assert (select count(*) from app.venta) = 0, 'no ve ventas ajenas';
  assert (select count(*) from app.cliente) = 0, 'no ve clientes ajenos';
  assert (select count(*) from app.caja_turno) = 0, 'no ve cajas ajenas';
  assert app.siguiente('venta') = 1, 'su numeración empieza en 1';
end $$;

-- ---------- En ropa (sin venta por peso) no se venden fracciones ----------
do $$
begin
  perform app.entrar_negocio('00000000-0000-0000-0000-0000000000e1', (select id from ids where clave = 'ropa'));
  update app.negocio_config set exige_caja_abierta = false;
  update app.producto set precio = 12 where nombre = 'Blusa';
  begin
    perform * from app.registrar_venta(
      jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Blusa'), 'cantidad', 1.5)),
      '[{"metodo":"efectivo","monto":18}]');
    assert false, 'ropa no se vende por fracciones';
  exception when invalid_parameter_value then null;
  end;
  assert (select total from app.registrar_venta(
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Blusa'), 'cantidad', 1, 'descuento', 2)),
    '[{"metodo":"tarjeta","monto":10}]')) = 10, 'la dueña puede dar descuento';
end $$;

reset role;
rollback;
