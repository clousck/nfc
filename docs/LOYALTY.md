# Programa de fidelidad — propuesta de diseño

> Estado: **borrador para discutir**. Nada de esto está construido todavía.

## 1. Objetivo

Que un negocio pueda ofrecer "**visita N veces y gana X**" (p. ej. 6 visitas = un café gratis)
usando el mismo stand con chip NFC + QR, con el mínimo de pasos para el cliente final.

Decisiones ya tomadas:

- El cliente se identifica con su **número de teléfono** (opción B): si quiere un premio, deja
  un dato de contacto.
- Se pide **consentimiento explícito** para usar sus datos.
- Basta con que el cliente **muestre su pantalla** para canjear, con protecciones que no sumen
  pasos (sección 5).

## 2. Tipos de chip

Hoy todos los chips redirigen directo. Se añade un modo por chip:

| Modo                 | Qué ve el cliente al escanear                                     |
| -------------------- | ----------------------------------------------------------------- |
| **Directo** (actual) | Va directo al destino (reseñas, WhatsApp, menú…)                  |
| **Fidelidad**        | Su tarjeta de sellos (+1 sello) y un botón para seguir al destino |
| **Encuesta**         | Una pregunta corta (1–5) y luego el destino; puede sumar sello    |

Un mismo negocio puede tener chips en modos distintos (p. ej. caja = fidelidad, mesas = directo).

## 3. Flujo del cliente

**Primera visita** (una sola vez):

1. Escanea el stand → página del negocio: _"Café X: 6 visitas = 1 café gratis"_.
2. Escribe su **teléfono** (y nombre, opcional).
3. Marca las casillas:
   - ☐ _Acepto que Café X guarde mi número para llevar mi tarjeta de sellos_ (**obligatoria**).
   - ☐ _Acepto que Café X me contacte con promociones_ (**opcional**, separada).
4. Recibe su primer sello. El navegador queda recordado (cookie segura de larga duración).

**Visitas siguientes**: escanea → _"¡+1 sello! Llevas 3 de 6"_ → botón para seguir. Cero
formularios.

**Al completar**: la tarjeta muestra _"¡Premio listo!"_ y el botón **Canjear ahora** (sección 5).

**Si cambia de móvil o borra el navegador**: _"¿Ya tienes tarjeta? Escribe tu número"_ → hay
que comprobar que el número es suyo (decisión pendiente, sección 8).

## 4. Protecciones contra trampas

Principio: que hacer trampa cueste más esfuerzo que lo que vale el premio.

| Riesgo                                        | Protección                                                           | Pasos extra para el cliente |
| --------------------------------------------- | -------------------------------------------------------------------- | --------------------------- |
| Escanear muchas veces seguidas                | **1 sello por día** por tarjeta (configurable)                       | Ninguno                     |
| Foto del QR para escanear desde casa          | Opción: **solo el chip NFC da sello**; el QR solo muestra la tarjeta | Ninguno                     |
| Copiar la URL del chip                        | Igual que la anterior, más el límite diario                          | Ninguno                     |
| Muchas tarjetas falsas con números inventados | Límite de altas por móvil/red y por día                              | Ninguno                     |
| Reutilizar la pantalla de premio              | Canje de un solo uso con pantalla "viva" (sección 5)                 | Ninguno                     |
| Robar los sellos de otro poniendo su número   | Comprobar el número al recuperar la tarjeta                          | Solo al cambiar de móvil    |

**Mejora a futuro (hardware):** chips **NTAG 424 DNA**. Cada vez que se acercan generan una
URL **distinta y firmada** que no se puede copiar ni reutilizar: es la única forma de garantizar
que el cliente estaba físicamente frente al stand. Cuestan algo más (~1–2 USD por chip) y su
configuración es más técnica. Recomendable si un negocio ofrece premios de valor alto.

## 5. Canje del premio (sin pasos extra)

1. El cliente, **frente al cajero**, pulsa **Canjear ahora**.
2. En ese momento el premio se marca como usado en el servidor y la tarjeta vuelve a 0.
3. La pantalla muestra una confirmación **"viva"**, imposible de falsificar con una captura:
   - un sello animado,
   - la **hora actual con segundos** avanzando,
   - el **color del día** (cambia cada día; el cajero lo conoce si el negocio quiere),
   - un código corto de canje (p. ej. `K7-42`).
4. El cajero solo mira la pantalla y entrega el premio.

Una captura de pantalla no sirve: la hora no avanza y el código ya figura como usado.

**Opcional, para premios de más valor:** un **PIN del local** (4 dígitos) que el cajero escribe
en el móvil del cliente para confirmar. Es un paso más, pero solo para el cajero.

## 6. Datos personales y privacidad

Hasta ahora el sistema no guarda datos personales. Con este programa sí (teléfono y nombre), así
que aplica la **Ley Orgánica de Protección de Datos Personales de Ecuador (LOPDP)**:

- **Consentimiento** expreso, informado y separado por finalidad (tarjeta vs. promociones).
- **Aviso de privacidad** corto y visible en la página de alta: quién guarda los datos, para qué,
  cuánto tiempo y cómo borrarlos.
- **Darse de baja** desde la propia tarjeta (borra el número y los sellos).
- **Mínimo de datos**: teléfono obligatorio; nombre opcional; nada más.
- El **enlace privado de estadísticas** del negocio mostrará solo cifras (tarjetas activas,
  premios canjeados), **nunca teléfonos ni nombres**, porque no pide contraseña.
- La lista de contactos que aceptaron promociones se entregaría al negocio por un canal
  protegido, nunca por ese enlace.
- Conviene un acuerdo simple con cada negocio: el negocio es el responsable de los datos de sus
  clientes y la plataforma es el encargado de tratarlos.

> Esto es una guía de diseño, no asesoría legal. Antes de lanzar, conviene que un abogado revise
> el aviso de privacidad y el acuerdo con los negocios.

### Encuestas y reseñas de Google

Cuidado con un patrón común y prohibido: preguntar _"¿Cómo fue tu visita?"_ y enviar a Google
**solo** a quienes ponen 5 estrellas (_review gating_). Google lo prohíbe y puede borrar las
reseñas del negocio. La encuesta puede existir, pero la invitación a reseñar debe mostrarse a
todos por igual.

## 7. Arquitectura

Todo lo que ve el cliente vive en **Cloudflare** (el principio de siempre: nada del cliente
depende de la Pi).

| Pieza                                                 | Dónde                                 | Qué guarda                                |
| ----------------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| Configuración del programa (visitas, premio, límites) | SQLite en la Pi → publicada en **KV** | Igual que los chips hoy                   |
| Clientes, tarjetas, sellos y canjes                   | **D1** (escrito por el Worker)        | Teléfono, consentimientos, sellos, canjes |
| Páginas de tarjeta, alta y canje                      | **Worker**                            | —                                         |
| Gestión y consulta                                    | Panel en la Pi                        | Lee D1 por la API                         |

Tablas nuevas en D1 (esbozo): `customers` (teléfono E.164, nombre, consentimientos con fecha),
`cards` (cliente × negocio, sellos actuales, totales), `stamps` (tarjeta, chip, fecha),
`redemptions` (tarjeta, código, fecha). El panel necesitará leer estas tablas (permiso D1 actual)
y, para dar de baja a alguien a pedido, escribir (permiso D1 **Edit**).

## 8. Decisiones pendientes

1. **Cómo comprobar el número al recuperar la tarjeta en otro móvil:**
   - Código por **WhatsApp** (WhatsApp Business API; tiene un costo pequeño por mensaje), o
   - Código por **SMS** (costo similar), o
   - **Sin código:** el cajero recupera la tarjeta desde el panel (gratis, pero da trabajo al
     local).
2. ¿Los sellos **caducan**? Por ejemplo, la tarjeta se reinicia tras 90 días sin visitas.
3. ¿El **QR también da sello**, o solo el chip NFC?
4. ¿Un mismo cliente con **una sola tarjeta para varios negocios** (una cuenta, varias
   tarjetas) o el alta se repite en cada negocio?
5. ¿Quién configura el premio: tú desde el panel o, a futuro, el propio negocio?
6. ¿Interesa probar **NTAG 424 DNA** con algún negocio de premios altos?

## 9. Fases propuestas

| Fase                             | Contenido                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1 — Tarjeta básica**          | Modo "fidelidad" por chip; alta con teléfono + consentimientos; 1 sello/día; tarjeta; canje con pantalla viva; vista en el panel; cifras en el enlace del negocio |
| **F2 — Recuperación y encuesta** | Recuperar tarjeta en otro móvil (según decisión 1); modo encuesta; caducidad de sellos                                                                            |
| **F3 — Extras**                  | Avisos por WhatsApp ("te falta 1 visita"), tarjeta en Google/Apple Wallet, NTAG 424 DNA                                                                           |
