# Programa de fidelidad — diseño

> Estado: **primera etapa desplegada** (2026-10-21). Las decisiones «sin login para negocios» y
> «sin QR en fidelidad» quedan **sustituidas** por [BUSINESS-ACCOUNTS.md](BUSINESS-ACCOUNTS.md)
> (cuentas de negocio y QR rotativo como prueba de presencia). Desde la fase 4 (2026-10-24) los
> canjes se validan con **móviles del personal vinculados** desde el portal, y el enlace de
> estadísticas ya no valida (sección 5).

## 1. Objetivo y decisiones

Que un negocio pueda ofrecer "**visita N veces y gana un premio**" con el stand NFC, con el
mínimo de pasos para el cliente final y **sin logins para nadie más que tú**.

| Tema                               | Decisión                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identificación                     | **Nombre + teléfono**, obligatorios, con consentimiento explícito                                                                                                               |
| Qué reconoce al cliente            | Una **cookie segura** que el sistema le da a su navegador en el alta (no existe un identificador del móvil que una web pueda leer, y el _fingerprinting_ no es fiable ni legal) |
| Recuperar la tarjeta en otro móvil | **No existe.** Una tarjeta vive en un solo móvil                                                                                                                                |
| Mismo número en otro móvil         | **No se permite** registrarlo de nuevo en ese negocio (tú puedes borrar la tarjeta desde tu panel para liberarlo)                                                               |
| Caducidad                          | **90 días sin visitas** → la tarjeta vuelve a 0 sellos                                                                                                                          |
| Qué da sello                       | **Solo el chip NFC.** Los chips de fidelidad **no tienen QR**                                                                                                                   |
| Tarjetas                           | **Una por negocio.** Un cliente puede tener tarjeta en varios negocios                                                                                                          |
| Premio                             | **Uno** por negocio. El negocio lo muestra **físicamente** (cartel/stand); el sistema solo guarda **cuántas visitas** hacen falta: lo activas tú; el dueño ajusta las visitas   |
| Login para negocios                | ~~Ninguno~~ → **portal** con enlace mágico (fase 4, [BUSINESS-ACCOUNTS.md](BUSINESS-ACCOUNTS.md))                                                                               |
| Canje                              | El cliente **muestra su pantalla**, con canje de un solo uso (sección 5)                                                                                                        |

## 2. Tipos de chip

| Modo                        | Qué ve el cliente al acercar el móvil                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| **Directo** (actual)        | Va directo al destino (reseñas, WhatsApp, menú…). Puede tener QR                              |
| **Fidelidad**               | Su tarjeta de sellos (+1 sello al día) y un botón para seguir al destino del chip. **Sin QR** |
| **Encuesta** (más adelante) | Una pregunta corta (1–5) y luego el destino                                                   |

Un mismo negocio puede tener chips en modos distintos (p. ej. caja = fidelidad, mesas = directo).

**Por qué los chips de fidelidad no tienen QR:** la URL del QR es la del chip más `?s=q`; quien
viera el QR obtendría la URL del chip y podría sumar sellos sin ir al local. El panel no
ofrecerá descargar el QR de un chip en modo fidelidad.

## 3. Flujo del cliente

**Primera visita** (una sola vez por negocio):

1. Acerca el móvil al stand → página del negocio: _"Café X · Completa 6 visitas y reclama tu
   premio"_.
2. Escribe su **nombre** y su **teléfono**.
3. Marca las casillas:
   - ☐ _Acepto que Café X guarde mi nombre y número para llevar mi tarjeta de sellos_
     (**obligatoria**).
   - ☐ _Acepto que Café X me contacte con promociones_ (**opcional**, separada).
4. Recibe su primer sello. Ese navegador queda recordado.

Si el número ya tiene tarjeta en ese negocio: _"Este número ya tiene una tarjeta en Café X en
otro móvil"_, y no se crea otra.

**Visitas siguientes**: acerca el móvil → _"¡+1 sello! Llevas 3 de 6"_ → botón para seguir. Cero
formularios. Si ya selló hoy: _"Ya sumaste el sello de hoy. ¡Vuelve mañana!"_.

**Al completar**: _"¡Premio listo! Muéstrale esta pantalla al cajero"_ y el botón **Canjear
ahora**.

**Si cambia de móvil o borra el navegador**: pierde esa tarjeta.

La cookie es del dominio `go.penginexr.com`, ninguna página ni script puede leerla, dura hasta
400 días (el máximo de Chrome) y se renueva en cada visita. Al acercar el móvil a un chip, el
teléfono siempre abre su **navegador principal**, que es donde vive la tarjeta.

## 4. Protecciones contra trampas

Principio: que hacer trampa cueste más esfuerzo que lo que vale el premio.

| Riesgo                                | Protección                                                             |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Escanear muchas veces seguidas        | **1 sello por día** por tarjeta                                        |
| Sumar sellos desde casa con un QR     | Los chips de fidelidad **no tienen QR**                                |
| Varias tarjetas para la misma persona | **Un número = una tarjeta** por negocio; límite de altas por red y día |
| Reutilizar la pantalla de premio      | Canje de un solo uso con pantalla "viva" (sección 5)                   |
| Usar la tarjeta de otro               | No hay recuperación: la tarjeta vive en un solo móvil                  |

**Límite honesto:** la URL de un chip NFC normal se puede leer con una app de NFC; quien la copie
podría sumar 1 sello al día sin ir al local. Para un café no compensa el esfuerzo; para premios
de valor alto existen los chips **NTAG 424 DNA**, que generan una URL **distinta y firmada** en
cada acercamiento.

## 5. Canje del premio

1. El cliente, **frente al cajero**, pulsa **Canjear mi premio** y confirma.
2. En ese momento la tarjeta vuelve a 0 y se crea un **código de canje único** (8 caracteres,
   p. ej. `K7PQ-42XZ`).
3. La pantalla del cliente muestra:
   - un **QR único** del canje,
   - la **hora actual con segundos** avanzando y un pulso animado,
   - el **color del día** (cambia cada día; el personal lo ve en su móvil vinculado),
   - el código escrito.
4. **Sin validar** (lo mínimo): el cajero mira la pantalla y entrega el premio.
5. **Validación opcional** (para estar seguros):
   - Una vez, el dueño **vincula el móvil del local** desde el portal ("Personal"): genera un QR
     o enlace de un solo uso (15 min), el personal lo abre en ese móvil y pulsa **Vincular**.
     Cada móvil se revoca por separado (detalle en
     [BUSINESS-ACCOUNTS.md §4](BUSINESS-ACCOUNTS.md#personal-vinculación-por-dispositivo)).
   - En cada canje, escanea el QR del cliente con la **cámara normal** del móvil: se abre
     _"✓ Canje válido · María · 6 visitas"_ o _"Este canje ya se usó"_ en rojo. Queda registrado
     qué móvil lo validó.
   - Si el QR no se puede escanear, el código se teclea en `go.penginexr.com/v` desde el móvil
     vinculado.
   - ~~Activar la validación desde el enlace de estadísticas~~: retirado en la fase 4. Ese enlace
     solo muestra cifras.
   - La pantalla del cliente cambia sola a **"✓ Premio entregado"** cuando el local valida.

Una captura de pantalla no sirve: el reloj no avanza y, si el local valida, un código ya usado
sale en rojo. Solo un móvil vinculado del negocio puede validar sus canjes; el cliente que
escanea su propio QR solo ve un aviso.

## 5b. La tarjeta de sellos (marketing)

- Aspecto de **tarjeta física**: nombre e iniciales del negocio, cuadrícula de N espacios.
- Cada visita es un **sello de tinta** con las iniciales del negocio, girado como un sello real.
- El último espacio es el **regalo 🎁**; el sello nuevo aparece con animación de **estampado**.
- Barra de progreso y mensaje: _"¡+1 sello! Llevas 3 de 6. Te faltan 3 visitas"_.
- Al completar: _"¡María, tu premio está listo!"_ en naranja con **confeti**.

## 6. Datos personales y privacidad

Con este programa se guardan datos personales (nombre y teléfono), así que aplica la **Ley
Orgánica de Protección de Datos Personales de Ecuador (LOPDP)**:

- **Consentimiento** expreso, informado y separado por finalidad (tarjeta vs. promociones).
- **Aviso de privacidad** corto y visible en la página de alta: quién guarda los datos, para qué,
  cuánto tiempo y cómo borrarlos.
- **Darse de baja** desde la propia tarjeta (borra nombre, número y sellos).
- **Borrado a pedido** desde tu panel (también libera el número).
- **Mínimo de datos**: nombre y teléfono; nada más.
- El **enlace de estadísticas** sin contraseña mostrará solo cifras (tarjetas activas, premios
  canjeados), **nunca nombres ni teléfonos**.
- Los contactos de quienes aceptaron promociones los exportas **tú** desde tu panel o el
  **dueño** desde su portal (`contactos.csv`); cada descarga del dueño queda en la auditoría.
- Acuerdo simple con cada negocio: el negocio es el **responsable** de los datos de sus clientes
  y la plataforma es la **encargada** de tratarlos.

> Esto es una guía de diseño, no asesoría legal. Antes de lanzar, conviene que un abogado revise
> el aviso de privacidad y el acuerdo con los negocios.

### Encuestas y reseñas de Google

Patrón prohibido: preguntar _"¿Cómo fue tu visita?"_ y enviar a Google **solo** a quienes ponen
5 estrellas (_review gating_). Google lo prohíbe y puede borrar las reseñas del negocio. La
invitación a reseñar debe mostrarse a todos por igual.

## 7. Arquitectura

Todo lo que ve el cliente vive en **Cloudflare**; la Pi sigue siendo tu panel.

| Pieza                                                   | Dónde                                           |
| ------------------------------------------------------- | ----------------------------------------------- |
| Páginas de tarjeta, alta, canje y baja                  | **Worker** (`go.penginexr.com`)                 |
| Modo de cada chip                                       | SQLite en la Pi → Worker → **KV**               |
| Visitas necesarias del negocio                          | **D1** (dueño o admin; desde la fase 4)         |
| Clientes, tarjetas, sellos y canjes                     | **D1**, escrito por el Worker                   |
| Consultar tarjetas, exportar contactos, borrar a pedido | Tu panel en la Pi, vía `/internal/*` del Worker |

Tablas nuevas en D1 (esbozo):

- `customers` (negocio, nombre, teléfono E.164, consentimientos con fecha; único por negocio +
  teléfono),
- `cards` (cliente, hash del token de la cookie, sellos actuales, último sello, estado),
- `stamps` (tarjeta, chip, fecha),
- `redemptions` (tarjeta, código, fecha).

Desde la fase 2 el panel ya no usa la API de Cloudflare: lee y borra a través de la API interna
del Worker ([BUSINESS-ACCOUNTS.md §3](BUSINESS-ACCOUNTS.md#3-plano-de-control-y-plano-de-datos)).
Fase 4: `loyalty_redemptions.validated_by_device` guarda qué móvil validó cada canje.

## 8. Fases

| Fase             | Contenido                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F1 — Tarjeta** | Modo fidelidad por chip (sin QR); visitas necesarias por negocio en tu panel; alta con nombre, teléfono y consentimientos; 1 sello/día; caducidad de 90 días; canje con pantalla viva; baja del cliente; en tu panel: tarjetas, exportar contactos con permiso y borrar; cifras en el enlace de estadísticas |
| **F2 — Extras**  | Modo encuesta, avisos por WhatsApp ("te falta 1 visita"), Google/Apple Wallet, NTAG 424 DNA (el portal para negocios ya existe: fase 4)                                                                                                                                                                      |
