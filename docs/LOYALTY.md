# Programa de fidelidad — diseño

> Estado: **diseño acordado, pendiente de construir**. Las decisiones del usuario están en la
> sección 1; lo que falta confirmar, en la sección 9.

## 1. Objetivo y decisiones

Que un negocio pueda ofrecer "**visita N veces y gana X**" (p. ej. 6 visitas = un café gratis)
usando el mismo stand con chip NFC + QR, con el mínimo de pasos para el cliente final.

| Tema                               | Decisión                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Identificación                     | **Teléfono + nombre**, obligatorios, con consentimiento explícito        |
| Recuperar la tarjeta en otro móvil | **No existe.** Una tarjeta vive en un solo móvil                         |
| Caducidad                          | **90 días sin visitas** → la tarjeta vuelve a 0 sellos                   |
| Qué da sello                       | **Solo el chip NFC.** El QR muestra la tarjeta pero no suma sellos       |
| Tarjetas                           | **Una por negocio.** Un cliente puede tener tarjeta en varios negocios   |
| Quién configura el premio          | **El propio negocio**                                                    |
| Canje                              | El cliente **muestra su pantalla**, con canje de un solo uso (sección 6) |

## 2. Tipos de chip

Hoy todos los chips redirigen directo. Se añade un modo por chip:

| Modo                        | Qué ve el cliente al escanear                                                   |
| --------------------------- | ------------------------------------------------------------------------------- |
| **Directo** (actual)        | Va directo al destino (reseñas, WhatsApp, menú…)                                |
| **Fidelidad**               | Su tarjeta de sellos (+1 sello si es por NFC) y un botón para seguir al destino |
| **Encuesta** (más adelante) | Una pregunta corta (1–5) y luego el destino                                     |

Un mismo negocio puede tener chips en modos distintos (p. ej. caja = fidelidad, mesas = directo).

## 3. Flujo del cliente

**Primera visita** (una sola vez por negocio):

1. Acerca el móvil al stand → página del negocio: _"Café X: 6 visitas = 1 café gratis"_.
2. Escribe su **nombre** y su **teléfono**.
3. Marca las casillas:
   - ☐ _Acepto que Café X guarde mi nombre y número para llevar mi tarjeta de sellos_
     (**obligatoria**).
   - ☐ _Acepto que Café X me contacte con promociones_ (**opcional**, separada).
4. Recibe su primer sello. Ese navegador queda recordado.

**Visitas siguientes**: acerca el móvil → _"¡+1 sello! Llevas 3 de 6"_ → botón para seguir.
Cero formularios.

**Si escanea el QR**: ve su tarjeta y el aviso _"Para sumar el sello de hoy, acerca el móvil al
chip"_.

**Al completar**: la tarjeta muestra _"¡Premio listo!"_ y el botón **Canjear ahora**.

**Si cambia de móvil o borra el navegador**: pierde esa tarjeta. Al registrarse de nuevo en el
mismo negocio con el mismo número, empieza una tarjeta nueva desde 0 y la anterior se cierra
(pendiente de confirmar, sección 9).

### Cómo se recuerda el móvil

Con una **cookie segura** del dominio `go.penginexr.com`, que el navegador no deja leer a ninguna
página ni script. Dura hasta 400 días (el máximo que permite Chrome) y se renueva en cada visita.

Que solo el NFC dé sellos ayuda también aquí: al acercar el móvil a un chip, el teléfono siempre
abre su **navegador principal** (Chrome o Safari). En cambio, un QR escaneado desde Instagram o
WhatsApp se abre en el navegador interno de esa app, que no comparte la cookie.

## 4. El QR no debe delatar la URL del chip

Hoy el QR es `go.penginexr.com/<código>?s=q`: quitando `?s=q` se obtiene la URL del chip, y la
regla "solo el NFC da sello" no protegería nada.

**Solución:** cada chip de fidelidad tendrá **dos códigos aleatorios independientes**: uno para
el chip NFC y otro para su QR. No se puede deducir uno del otro. Los escaneos de ambos cuentan
para el mismo chip en las estadísticas. Los QR ya impresos de chips en modo directo siguen
funcionando igual.

## 5. Protecciones contra trampas

Principio: que hacer trampa cueste más esfuerzo que lo que vale el premio.

| Riesgo                                   | Protección                                                          | Pasos extra para el cliente |
| ---------------------------------------- | ------------------------------------------------------------------- | --------------------------- |
| Escanear muchas veces seguidas           | **1 sello por día** por tarjeta                                     | Ninguno                     |
| Foto del QR para sumar sellos desde casa | **El QR no da sellos** y tiene su propio código (sección 4)         | Ninguno                     |
| Leer el chip con una app y copiar su URL | Límite diario + caducidad; para premios altos, NTAG 424 DNA         | Ninguno                     |
| Muchas tarjetas con números inventados   | Una tarjeta por número y negocio; límite de altas por red y día     | Ninguno                     |
| Reutilizar la pantalla de premio         | Canje de un solo uso con pantalla "viva" (sección 6)                | Ninguno                     |
| Usar la tarjeta de otro                  | No existe recuperación por número: la tarjeta vive en un solo móvil | Ninguno                     |

**Límite honesto:** la URL de un chip NFC normal se puede leer con cualquier app de NFC. Quien la
copie podría sumar 1 sello al día sin ir al local. Para un café gratis no compensa el esfuerzo;
para premios de valor alto existen los chips **NTAG 424 DNA**, que generan una URL **distinta y
firmada** en cada acercamiento (~1–2 USD por chip, configuración más técnica).

## 6. Canje del premio (sin pasos extra)

1. El cliente, **frente al cajero**, pulsa **Canjear ahora**.
2. En ese momento el premio se marca como usado en el servidor y la tarjeta vuelve a 0.
3. La pantalla muestra una confirmación **"viva"**, imposible de falsificar con una captura:
   - un sello animado,
   - la **hora actual con segundos** avanzando,
   - el **color del día** (cambia cada día),
   - un código corto de canje (p. ej. `K7-42`).
4. El cajero solo mira la pantalla y entrega el premio.

**Opcional, para premios de más valor:** un **PIN del local** (4 dígitos) que el cajero escribe
en el móvil del cliente para confirmar.

## 7. Portal del negocio

Como el negocio configura su propio premio, necesita entrar con **identificación**: el enlace de
estadísticas actual no pide contraseña y no sirve para editar.

**Propuesta:** un portal en Cloudflare protegido por **Cloudflare Access** (el mismo sistema de
tu panel): el dueño escribe su correo y recibe un código. No hay contraseñas que gestionar.

- Gratis hasta **50 usuarios** (negocios). Pasado eso, cuesta o habría que hacer un login propio.
- Funciona aunque la Pi esté apagada.
- El dueño puede:
  - activar o pausar su programa,
  - definir **visitas necesarias** y el **premio** (texto),
  - ver tarjetas activas, sellos y canjes,
  - ver y descargar la lista de clientes **que aceptaron promociones** (nombre y teléfono).
    Esto solo es posible porque el portal exige identificación.

Para esto cada negocio necesita un **correo del dueño** registrado en tu panel.

## 8. Datos personales y privacidad

Con este programa se guardan datos personales (nombre y teléfono), así que aplica la **Ley
Orgánica de Protección de Datos Personales de Ecuador (LOPDP)**:

- **Consentimiento** expreso, informado y separado por finalidad (tarjeta vs. promociones).
- **Aviso de privacidad** corto y visible en la página de alta: quién guarda los datos, para qué,
  cuánto tiempo y cómo borrarlos.
- **Darse de baja** desde la propia tarjeta (borra nombre, número y sellos).
- **Mínimo de datos**: nombre y teléfono; nada más.
- El **enlace de estadísticas** sin contraseña mostrará solo cifras (tarjetas activas, premios
  canjeados), **nunca nombres ni teléfonos**.
- Los contactos solo se ven en el portal del negocio (con identificación) y solo los de quienes
  aceptaron promociones.
- Acuerdo simple con cada negocio: el negocio es el **responsable** de los datos de sus clientes
  y la plataforma es la **encargada** de tratarlos.

> Esto es una guía de diseño, no asesoría legal. Antes de lanzar, conviene que un abogado revise
> el aviso de privacidad y el acuerdo con los negocios.

### Encuestas y reseñas de Google

Patrón prohibido: preguntar _"¿Cómo fue tu visita?"_ y enviar a Google **solo** a quienes ponen
5 estrellas (_review gating_). Google lo prohíbe y puede borrar las reseñas del negocio. La
invitación a reseñar debe mostrarse a todos por igual.

## 9. Arquitectura

Todo lo que ven el cliente y el negocio vive en **Cloudflare**; la Pi sigue siendo tu panel.

| Pieza                                          | Dónde                                            |
| ---------------------------------------------- | ------------------------------------------------ |
| Páginas de tarjeta, alta y canje               | **Worker** (`go.penginexr.com`)                  |
| Portal del negocio                             | **Worker** + Cloudflare Access                   |
| Programas, clientes, tarjetas, sellos y canjes | **D1**                                           |
| Modo de cada chip y su código de QR            | SQLite en la Pi → publicado en **KV** (como hoy) |
| Tu gestión                                     | Panel en la Pi (lee D1 por la API)               |

Como el negocio edita su programa desde el portal, **la configuración del programa vive en D1**,
no en la Pi.

Tablas nuevas en D1 (esbozo):

- `programs` (negocio, visitas necesarias, premio, activo),
- `customers` (negocio, nombre, teléfono E.164, consentimientos con fecha),
- `cards` (cliente, sellos actuales, último sello, estado),
- `stamps` (tarjeta, chip, fecha),
- `redemptions` (tarjeta, código, fecha).

## 10. Pendiente de confirmar

1. **Mismo número en un móvil nuevo:** ¿empieza tarjeta nueva desde 0 y se cierra la anterior?
   (Recomendado; la alternativa es bloquear el número y el cliente no podría volver a participar.)
2. **Portal con Cloudflare Access** (correo + código, gratis hasta 50 negocios): ¿te parece bien?
3. **Caducidad**: "90 días **sin visitas** → vuelve a 0" (recomendado, fácil de entender) o
   "cada sello caduca a los 90 días".
4. ¿El premio es **siempre uno** por negocio, o un negocio podría tener varios a la vez
   (p. ej. 6 visitas = café, 12 = postre)?

## 11. Fases

| Fase                        | Contenido                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1 — Tarjeta**            | Modo fidelidad por chip; código propio para el QR; alta con nombre, teléfono y consentimientos; 1 sello/día por NFC; caducidad; canje con pantalla viva; baja; tú configuras el programa desde tu panel; cifras en el enlace de estadísticas |
| **F2 — Portal del negocio** | Acceso con Cloudflare Access; el negocio configura su programa y ve sus clientes que aceptaron promociones                                                                                                                                   |
| **F3 — Extras**             | Modo encuesta, avisos por WhatsApp ("te falta 1 visita"), Google/Apple Wallet, NTAG 424 DNA                                                                                                                                                  |

F1 ya sirve para un piloto con un negocio real: tú configuras su premio mientras se construye
el portal.
