# Publicar Al Cien

## Bienvenido

Esta guía publica Al Cien en tu cuenta de Google Cloud. Tarda unos 25 minutos; casi todo es esperar.

Solo necesitas una forma de pago (tarjeta) en tu cuenta de Google Cloud. Si todavía no la tienes, créala en
[console.cloud.google.com/billing/create](https://console.cloud.google.com/billing/create).

Pulsa **Comenzar**.

## Publicar

Copia este comando en la terminal de abajo (el ícono de la derecha lo copia por ti) y pulsa Enter:

```sh
bash deploy/desplegar.sh
```

Te va a preguntar:

1. **El nombre del proyecto**: pulsa Enter para aceptar el que sugiere.
2. **La cuenta de facturación**, solo si tienes más de una: escribe el número y Enter.

Si aparece una ventana para **autorizar Cloud Shell**, pulsa **Autorizar**.

Al final verás en verde: **¡Listo! Abre Al Cien en: https://alcien-…run.app**. Ese es tu enlace.

## Entrar

Abre el enlace en tu celular, escribe tu número y pide el código.

Mientras Meta aprueba la plantilla de WhatsApp, el código no llega por WhatsApp. Míralo aquí:

```sh
bash deploy/ver-codigos.sh
```

Solo tú puedes ver esos códigos, así que nadie más entra sin que tú le des el suyo.

## Listo

Al Cien está publicado. Para instalar una versión nueva, vuelve a abrir el enlace de la guía y corre de nuevo `bash deploy/desplegar.sh`: actualiza la app sin borrar nada.

Si algo sale en rojo, copia el mensaje y envíaselo a Claude.
