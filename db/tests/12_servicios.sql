-- Tanda 4 de módulos: citas, comisiones, órdenes de trabajo, reservas y membresías.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-0000000000e1', '+593990000101'),   -- dueña de la peluquería
  ('00000000-0000-0000-0000-0000000000e2', '+593990000102');   -- cajera

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;
insert into ids values ('pelu', app.crear_negocio('00000000-0000-0000-0000-0000000000e1', 'T119', 'Pelu E'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-0000000000e2', id, 'cajero' from ids where clave = 'pelu';

create function pg_temp.id(c text) returns uuid language sql as $$ select id from ids where clave = c $$;
create function pg_temp.dueña() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000e1', (select id from ids where clave = 'pelu'));
$$;
create function pg_temp.cajera() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000e2', (select id from ids where clave = 'pelu'));
$$;
grant execute on function pg_temp.id(text), pg_temp.dueña(), pg_temp.cajera() to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

-- ---------- Citas y comisiones ----------
do $$
declare
  p1 uuid; p2 uuid; corte uuid; tinte uuid; c1 uuid; c2 uuid;
begin
  perform pg_temp.dueña();
  perform app.abrir_caja(20);
  insert into app.profesional (negocio_id, nombre, comision_pct) values (app.negocio_actual(), 'Ana', 40) returning id into p1;
  insert into app.profesional (negocio_id, nombre, comision_pct) values (app.negocio_actual(), 'Beto', 30) returning id into p2;
  insert into app.producto (negocio_id, nombre, unidad, precio, maneja_stock, duracion_min)
    values (app.negocio_actual(), 'Corte prueba', 'Servicio', 10, false, 45) returning id into corte;
  insert into app.producto (negocio_id, nombre, unidad, precio, maneja_stock, duracion_min, comision_pct)
    values (app.negocio_actual(), 'Tinte prueba', 'Servicio', 30, false, 90, 20) returning id into tinte;
  insert into ids values ('ana', p1), ('beto', p2), ('corte', corte), ('tinte', tinte);

  c1 := app.agendar_cita(jsonb_build_object('nombre', 'María', 'celular', '0991234567', 'profesional_id', p1,
          'servicio_id', corte, 'inicio', '2030-05-10 10:00-05'));
  assert (select fin from app.cita where id = c1) = '2030-05-10 10:45-05', 'dura lo que dura el servicio';
  -- Ana no puede a las 10:30, Beto sí
  begin
    perform app.agendar_cita(jsonb_build_object('nombre', 'Rosa', 'profesional_id', p1, 'servicio_id', corte, 'inicio', '2030-05-10 10:30-05'));
    assert false, 'Ana ya está ocupada';
  exception when exclusion_violation then null;
  end;
  c2 := app.agendar_cita(jsonb_build_object('nombre', 'Rosa', 'profesional_id', p2, 'servicio_id', tinte, 'inicio', '2030-05-10 10:30-05'));
  -- A las 10:45 Ana ya está libre
  perform app.agendar_cita(jsonb_build_object('nombre', 'Lola', 'profesional_id', p1, 'servicio_id', corte, 'inicio', '2030-05-10 10:45-05'));
  -- Reprogramar a un horario ocupado falla; cancelar libera
  begin
    perform app.cambiar_cita(c1, 'confirmada', '2030-05-10 10:30-05');
    assert false, 'choca con la cita de Lola';
  exception when exclusion_violation then null;
  end;
  perform app.cambiar_cita(c1, 'confirmada', '2030-05-10 10:00-05');   -- su propio horario sí
  insert into ids values ('cita1', c1), ('cita2', c2);
end $$;

-- La cajera cobra la cita de María con un tinte extra: comisión por línea
do $$
declare
  r record;
begin
  perform pg_temp.cajera();
  select * into r from app.cobrar_cita(pg_temp.id('cita1'), jsonb_build_array(
      jsonb_build_object('producto_id', pg_temp.id('corte'), 'cantidad', 1),
      jsonb_build_object('producto_id', pg_temp.id('tinte'), 'cantidad', 1)),
    '[{"metodo":"efectivo","monto":40,"recibido":50}]');
  assert r.total = 40 and r.vuelto = 10, 'cobro de la cita';
  assert r.comision = 10, format('40 %% de 10 + 20 %% de 30 = 10 (salió %s)', r.comision);
  assert (select estado from app.cita where id = pg_temp.id('cita1')) = 'atendida', 'queda atendida';
  begin
    perform app.cobrar_cita(pg_temp.id('cita1'), null, '[{"metodo":"efectivo","monto":10}]');
    assert false, 'no se cobra dos veces';
  exception when object_not_in_prerequisite_state then null;
  end;
  -- La cajera no paga comisiones
  begin
    perform app.pagar_comisiones(pg_temp.id('ana'));
    assert false, 'la cajera no paga comisiones';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Cita sin productos: cobra el servicio agendado; anular la venta anula la comisión
do $$
declare
  r record;
  v_pagado numeric;
begin
  perform pg_temp.dueña();
  select * into r from app.cobrar_cita(pg_temp.id('cita2'), null, '[{"metodo":"transferencia","monto":30}]');
  assert r.total = 30 and r.comision = 6, 'tinte con comisión propia de 20 %';
  perform app.anular_venta(r.venta_id, 'Error');
  assert (select estado from app.comision where venta_id = r.venta_id) = 'anulada', 'la comisión se anula con la venta';

  v_pagado := app.pagar_comisiones(pg_temp.id('ana'));
  assert v_pagado = 10, format('se paga lo pendiente de Ana (salió %s)', v_pagado);
  assert app.pagar_comisiones(pg_temp.id('ana')) = 0, 'ya no queda nada';
  assert exists (select 1 from app.caja_movimiento where motivo = 'Comisiones de Ana' and monto = 10 and tipo = 'retiro'), 'sale de la caja';
end $$;

-- ---------- Órdenes de trabajo ----------
do $$
declare
  o uuid; rep uuid; mo uuid; r record; pub jsonb;
begin
  perform pg_temp.dueña();
  perform app.activar_modulo('M13');
  insert into app.producto (negocio_id, nombre, unidad, precio, costo) values (app.negocio_actual(), 'Pantalla A10', 'Unidad', 45, 25) returning id into rep;
  update app.producto set stock = 3 where id = rep;
  insert into app.producto (negocio_id, nombre, unidad, precio, maneja_stock) values (app.negocio_actual(), 'Mano de obra', 'Servicio', null, false) returning id into mo;
  o := app.crear_orden(jsonb_build_object('nombre', 'Pedro', 'celular', '0987654321', 'equipo', 'Samsung A10',
         'identificador', 'IMEI 3569', 'problema', 'Pantalla rota', 'tecnico_id', pg_temp.id('beto')));
  insert into ids values ('orden', o), ('pantalla', rep), ('mo', mo);
  assert (select numero from app.orden where id = o) = 1, 'numeración propia';
  perform app.estado_orden(o, 'diagnostico', 'Revisado', 'Cambiar pantalla');
  begin
    perform app.agregar_a_orden(o, jsonb_build_array(jsonb_build_object('producto_id', mo, 'tipo', 'mano_obra')));
    assert false, 'la mano de obra sin precio necesita uno';
  exception when invalid_parameter_value then null;
  end;
  perform app.agregar_a_orden(o, jsonb_build_array(
    jsonb_build_object('producto_id', rep, 'tipo', 'repuesto'),
    jsonb_build_object('producto_id', mo, 'tipo', 'mano_obra', 'precio', 15)));
  perform app.estado_orden(o, 'lista');
  begin
    perform app.estado_orden(o, 'entregada');
    assert false, 'no se entrega sin cobrar';
  exception when object_not_in_prerequisite_state then null;
  end;

  pub := app.orden_publica((select token_publico from app.orden where id = o));
  assert pub->>'estado' = 'lista' and (pub->>'total')::numeric = 60, 'seguimiento público';
  assert jsonb_array_length(pub->'historial') = 3, 'recibida, diagnóstico, lista';
  assert app.orden_publica('x') is null, 'token inválido';
end $$;

do $$
declare
  r record;
begin
  perform pg_temp.cajera();   -- la cajera cobra aunque la mano de obra tenga precio acordado
  select * into r from app.cobrar_orden(pg_temp.id('orden'), '[{"metodo":"efectivo","monto":60}]');
  assert r.total = 60, 'cobro de la orden';
  assert current_setting('app.rol') = 'cajero', 'el rol vuelve a ser cajero';
  assert (select stock from app.producto where id = pg_temp.id('pantalla')) = 2, 'el repuesto baja del stock';
  perform app.estado_orden(pg_temp.id('orden'), 'entregada');
  assert (select sum(monto) from app.comision where venta_id = r.venta_id) = 18, '30 % del técnico sobre 60';
end $$;

-- ---------- Reservas ----------
do $$
declare
  h uuid; rv uuid; r record;
begin
  perform pg_temp.dueña();
  perform app.activar_modulo('M26');
  h := app.crear_recurso('Habitación 1', 'Habitación', 'noche', 25, 2);
  rv := app.reservar(jsonb_build_object('recurso_id', h, 'nombre', 'Familia Loor', 'desde', '2030-06-01 14:00-05', 'hasta', '2030-06-04 12:00-05'));
  assert (select unidades from app.reserva where id = rv) = 3 and (select total from app.reserva where id = rv) = 75, '3 noches';
  begin
    perform app.reservar(jsonb_build_object('recurso_id', h, 'nombre', 'Otro', 'desde', '2030-06-03 14:00-05', 'hasta', '2030-06-05 12:00-05'));
    assert false, 'fechas cruzadas';
  exception when exclusion_violation then null;
  end;
  -- El día de salida se puede volver a reservar desde las 14:00
  perform app.reservar(jsonb_build_object('recurso_id', h, 'nombre', 'Otro', 'desde', '2030-06-04 14:00-05', 'hasta', '2030-06-05 12:00-05'));

  perform pg_temp.cajera();
  select * into r from app.cobrar_reserva(rv, '[{"metodo":"tarjeta","monto":75}]');
  assert r.total = 75, 'cobro de la reserva';
  begin
    perform app.estado_reserva(rv, 'cancelada');
    assert false, 'una reserva cobrada no se cancela';
  exception when object_not_in_prerequisite_state then null;
  end;
  perform app.estado_reserva(rv, 'en_curso');
end $$;

-- ---------- Membresías ----------
do $$
declare
  pl uuid; cli uuid; r record; a jsonb;
begin
  perform pg_temp.dueña();
  perform app.activar_modulo('M22');
  pl := app.crear_plan_membresia('Mensual 12 clases', 35, 30, 12);
  insert into app.cliente (negocio_id, nombre, celular) values (app.negocio_actual(), 'Carla', '0991112222') returning id into cli;
  begin
    perform app.registrar_asistencia(cli);
    assert false, 'sin membresía no entra';
  exception when object_not_in_prerequisite_state then null;
  end;
  select * into r from app.vender_membresia(cli, pl, '[{"metodo":"efectivo","monto":35}]');
  assert r.hasta = (now() at time zone 'America/Guayaquil')::date + 29, '30 días';
  a := app.registrar_asistencia(cli);
  assert (a->>'sesiones_restantes')::int = 11, 'descuenta una clase';
  -- Renovar antes de que venza: empieza cuando termina la actual
  select * into r from app.vender_membresia(cli, pl, '[{"metodo":"efectivo","monto":35}]');
  assert r.hasta = (now() at time zone 'America/Guayaquil')::date + 59, 'renovación encadenada';
  -- Anular la venta anula la membresía
  perform app.anular_venta(r.venta_id, 'Se arrepintió');
  assert (select estado from app.membresia_cliente where id = r.membresia_id) = 'anulada', 'membresía anulada';
end $$;

-- ---------- Aislamiento ----------
select set_config('app.negocio_id', '', true);
do $$
begin
  assert (select count(*) from app.cita) = 0, 'sin negocio no se ven citas';
  assert (select count(*) from app.orden) = 0, 'sin negocio no se ven órdenes';
  assert (select count(*) from app.comision) = 0, 'sin negocio no se ven comisiones';
end $$;

rollback;
