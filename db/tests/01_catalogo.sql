-- Catálogo: la carga desde el Excel está completa y es coherente.
begin;

do $$
declare n int;
begin
  select count(*) into n from catalogo.modulo;
  assert n = 26, format('se esperaban 26 módulos, hay %s', n);

  select count(*) into n from catalogo.modulo where tipo = 'nucleo';
  assert n = 6, format('se esperaban 6 módulos núcleo, hay %s', n);

  select count(*) into n from catalogo.familia;
  assert n = 16, format('se esperaban 16 familias, hay %s', n);

  select count(*) into n from catalogo.tipo_negocio where estado = 'aprobado';
  assert n >= 200, format('se esperaban al menos 200 tipos de negocio, hay %s', n);

  -- Toda familia activa todos los módulos núcleo
  select count(*) into n
  from catalogo.familia f cross join catalogo.modulo m
  where m.tipo = 'nucleo'
    and not exists (select 1 from catalogo.familia_modulo fm
                    where fm.familia = f.codigo and fm.modulo = m.codigo and fm.modo = 'S');
  assert n = 0, format('%s combinaciones familia × núcleo sin activar', n);

  -- Toda familia tiene al menos un tipo de negocio
  select count(*) into n from catalogo.familia f
  where not exists (select 1 from catalogo.tipo_negocio t where t.familia = f.codigo);
  assert n = 0, format('%s familias sin tipos de negocio', n);

  -- Pro incluye todos los módulos; Gratis incluye ventas y caja
  select count(*) into n from catalogo.modulo m
  where not exists (select 1 from catalogo.plan_modulo pm where pm.plan = 'pro' and pm.modulo = m.codigo);
  assert n = 0, 'el plan Pro debe incluir todos los módulos';
  assert exists (select 1 from catalogo.plan_modulo where plan = 'gratis' and modulo = 'M01'), 'Gratis debe incluir Ventas';
  assert exists (select 1 from catalogo.plan_modulo where plan = 'gratis' and modulo = 'M02'), 'Gratis debe incluir Caja';
  assert not exists (select 1 from catalogo.plan_modulo where plan = 'emprendedor' and modulo = 'M19'), 'La facturación SRI empieza en el plan Negocio';

  -- Cada plan superior incluye todo lo del inferior
  select count(*) into n
  from catalogo.plan_modulo a
  join catalogo.plan pa on pa.codigo = a.plan
  join catalogo.plan pb on pb.orden = pa.orden + 1
  where not exists (select 1 from catalogo.plan_modulo b where b.plan = pb.codigo and b.modulo = a.modulo);
  assert n = 0, format('%s módulos desaparecen al subir de plan', n);

  -- Dependencias sin ciclos
  select count(*) into n from (
    with recursive cadena(origen, actual, profundidad) as (
      select modulo, requiere, 1 from catalogo.modulo_dependencia
      union all
      select c.origen, d.requiere, c.profundidad + 1
      from cadena c join catalogo.modulo_dependencia d on d.modulo = c.actual
      where c.profundidad < 30
    )
    select 1 from cadena where origen = actual
  ) ciclos;
  assert n = 0, 'hay dependencias circulares entre módulos';

  -- Los productos de ejemplo tienen unidad
  select count(*) into n from catalogo.plantilla_producto where coalesce(unidad, '') = '';
  assert n = 0, 'productos de ejemplo sin unidad';
end $$;

rollback;
