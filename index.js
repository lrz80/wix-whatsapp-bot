import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import twilio from 'twilio';
import pkg from 'pg';
import twilioPkg from 'twilio';

const { Pool } = pkg;
const { twiml: TwilioTwiml } = twilioPkg;

const db = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get("/", (req, res) => {
  res.send("🚀 Backend activo y funcionando.");
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Manejo de errores globales que podrían crashear el proceso
process.on('uncaughtException', (err) => {
  console.error('🛑 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🛑 Unhandled Rejection:', reason);
});

app.post('/api/new-bot', async (req, res) => {
  const { businessName, ownerName, whatsappNumber, openingHours, services, businessemail, twilioNumber } = req.body;

  try {
    const existing = await db.query(
      'SELECT * FROM clients WHERE whatsapp = $1',
      [whatsappNumber]
    );

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE clients SET
          business_name = $1,
          owner_name = $2,
          opening_hours = $3,
          business_email = $4,
          services = $5
          ${twilioNumber ? ', twilio_number = $6' : ''}
        WHERE whatsapp = $${twilioNumber ? 6 : 5}`,
        twilioNumber
          ? [businessName, ownerName, openingHours, services, businessEmail, twilioNumber, whatsappNumber]
          : [businessName, ownerName, openingHours, services, businessEmail, whatsappNumber]
      );
    } else {
      await db.query(
        `INSERT INTO clients (whatsapp, business_name, business_email, owner_name, opening_hours, services${twilioNumber ? ', twilio_number' : ''})
         VALUES ($1, $2, $3, $4, $5${twilioNumber ? ', $6' : ''})`,
        twilioNumber
          ? [whatsappNumber, businessName, ownerName, openingHours, businessEmail, services, twilioNumber]
          : [whatsappNumber, businessName, ownerName, openingHours, businessEmail, services]
      );
    }

    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: `whatsapp:${whatsappNumber}`,
      body: `¡Hola ${ownerName}! Tu chatbot para ${businessName} ha sido creado.`
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al guardar en DB:", err);
    res.status(500).json({ success: false });
  }
});

const lastInteraction = new Map();

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const to = req.body.To;
  const message = req.body.Body?.trim();

  console.log("📬 Webhook activado con ID:", req.body.MessageSid);
  console.log("📩 Mensaje:", message);
  console.log("📲 De:", from);
  console.log("📥 A:", to);

  const twiml = new TwilioTwiml.MessagingResponse();
  res.type('text/xml').send(twiml.toString());

async function sendLongMessageInChunks(to, from, text, isEnglish = false, chunkSize = 1500) {
  const chunks = [];

  while (text.length > 0) {
    let chunk = text.slice(0, chunkSize);

    // Corta en el último salto de línea si es posible
    const lastBreak = chunk.lastIndexOf("\n");
    if (lastBreak > 100) {
      chunk = chunk.slice(0, lastBreak);
    }

    chunks.push(chunk);
    text = text.slice(chunk.length).trim();
  }

  for (let i = 0; i < chunks.length; i++) {
    let body = chunks[i];

    // Encabezado en el primer bloque
    if (i === 0) {
      body = isEnglish
        ? "📋 Here is all the information you requested:\n\n" + body
        : "📋 Aquí tienes toda la información solicitada:\n\n" + body;
    }

    // Mensaje de cierre en el último bloque
    if (i === chunks.length - 1) {
      body += isEnglish
        ? "\n\nIf you have any questions, feel free to ask. I'm here to help 😊"
        : "\n\nSi tienes alguna pregunta, estaré encantado(a) de ayudarte 😊";
    }

    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body
    });
  }
}
function detectSpecificIntent(message) {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?]/g, "")
    .trim();

  const priceTriggers = [
    "precios", "cuanto cuesta", "costos", "precio", "valores",
    "cost", "price", "how much", "rates", "pricing"
  ];

  const includeTriggers = [
    "que incluye", "que contiene", "que ofrece", "que esta incluido",
    "what's included", "what does it include", "included", "features", "benefits"
  ];

  const durationTriggers = [
    "cuanto dura", "duracion", "por cuanto tiempo", "tiempo del programa",
    "how long", "duration", "how many weeks", "program length"
  ];

  if (priceTriggers.some(p => normalized.includes(p))) return "price";
  if (includeTriggers.some(p => normalized.includes(p))) return "includes";
  if (durationTriggers.some(p => normalized.includes(p))) return "duration";

  return null;
}

    // Procesamiento diferido
  setTimeout(async () => {
    function isGenericInfoRequest(message) {
      const normalized = message.toLowerCase().trim();
      const genericPhrases = [
        "quiero información", "quiero info", "dame información", "dame info", "me interesa",
        "más info", "información por favor", "necesito info", "envíame información",
        "quiero saber más", "quiero detalles", "puedes darme info", "cuéntame más",
        "necesito más información"
      ];
      return genericPhrases.some(phrase => normalized.includes(phrase));
    }
    function isGratitudeMessage(message) {
      const normalized = message.toLowerCase();
      const gratitudePhrases = [
        "gracias", "muchas gracias", "mil gracias",
        "thank you", "thanks", "thanks a lot", "thank u"
      ];
      return gratitudePhrases.some(phrase => normalized.includes(phrase));
    }
    function isStrongInfoIntentBilingual(message) {
      const normalized = message
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[¿?]/g, "")
        .trim();

      // Si el mensaje es muy corto (menos de 8 palabras), lo tratamos como general
      const isShortMessage = normalized.split(" ").length <= 8;

      const triggers = [
        // Español
        "quiero toda la informacion", "quiero toda la info",
        "dame toda la informacion", "dame toda la info", "quiero todo", "dame todo",
        "mandame todo", "enviame todo", "toda la informacion", "toda la info",
        "necesito toda la informacion", "necesito todo", "quiero saber todo",
        "informacion completa",

        // Inglés
        "i want all the information", "i want all the info", "send me all the info",
        "send me everything", "i want everything", "all the information",
        "full information", "complete information"
      ];

      return isShortMessage && triggers.some(trigger => normalized === trigger || normalized.includes(trigger));
    }

    function isReadyToBuy(message) {
      const normalized = message.toLowerCase();

      // Frases claras de intención de compra
      const buyingIntents = [
        "quiero pagar", "dónde pago", "donde pago",
        "quiero registrarme", "quiero inscribirme",
        "estoy lista para comenzar", "estoy listo para comenzar",
        "cómo empiezo", "como empiezo", "quiero empezar",
        "quiero agendar", "quiero comenzar", "listo para empezar"
      ];

      return buyingIntents.some(phrase => normalized.includes(phrase));
    }

    try {
      let reply = ""; // IMPORTANTE: inicializamos reply

      if (!to || !to.startsWith("whatsapp:")) {
        console.error("❌ Número receptor inválido:", to);
        return;
      }

      const result = await db.query(
        'SELECT * FROM clients WHERE twilio_number = $1',
        [to]
      );

      if (result.rows.length === 0) {
        await client.messages.create({
          from: to,
          to: from,
          body: "Este número aún no está configurado con ningún negocio. Contáctanos para activarlo."
        });
        return;
      }

      const customer = result.rows[0];

      const isMsgEnglish = isEnglish(message);

      // Detectar si pregunta por una intención específica (precios, duración, etc.)
      const specificIntent = detectSpecificIntent(message);

      if (specificIntent === "price") {
        const priceText = isMsgEnglish
          ? "Our programs are priced as follows:\n\n• 4 weeks – $135\n• 8 weeks – $250\n• 12 weeks – $350\n• Nutrition-only (8 weeks) – $150"
          : "Nuestros programas tienen los siguientes precios:\n\n• 4 semanas – $135\n• 8 semanas – $250\n• 12 semanas – $350\n• Solo nutrición (8 semanas) – $150";

        await client.messages.create({ from: to, to: from, body: priceText });
        return;
      }

      if (specificIntent === "includes") {
        const includesText = isMsgEnglish
          ? "The program includes:\n• Personalized macros\n• Nutrition coaching\n• Custom training plan\n• Weekly check-ins\n• Core/postpartum recovery program\n• Nutrition education modules"
          : "El programa incluye:\n• Macros personalizados\n• Asesoría nutricional\n• Plan de entrenamiento personalizado\n• Seguimiento semanal\n• Ejercicios para core/recuperación postparto\n• Módulos educativos de nutrición";

        await client.messages.create({ from: to, to: from, body: includesText });
        return;
      }

      if (specificIntent === "duration") {
        const durationText = isMsgEnglish
          ? "Our programs last 4, 8, or 12 weeks. We also offer an 8-week nutrition-only option."
          : "Nuestros programas duran 4, 8 o 12 semanas. También ofrecemos una opción de solo nutrición por 8 semanas.";

        await client.messages.create({ from: to, to: from, body: durationText });
        return;
      }

      function isStrongInfoIntentBilingual(message) {
        const normalized = message
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[¿?]/g, "")
          .trim();

        const triggers = [
          // Español
          "quiero toda la informacion", "quiero toda la info", "quiero mas informacion",
          "dame toda la informacion", "dame toda la info", "quiero todo", "dame todo",
          "mandame todo", "enviame todo", "puedes darme toda la informacion",
          "me puedes dar toda la informacion", "puedes enviarme toda la informacion",
          "podrias darme toda la informacion", "toda la informacion por favor",
          "toda la info por favor", "necesito toda la informacion", "necesito todo",
          "quiero saber todo", "quiero saberlo todo", "quiero informacion", "me interesa saber todo",

          // Inglés
          "i want all the information", "i want all the info", "send me all the info",
          "send me everything", "i want everything", "can you give me all the info",
          "could you send me all the information", "can i get all the information",
          "i'd like all the information", "i need all the info", "give me everything",
          "i want more information", "i need more information", "please send me all info"
        ];

        return triggers.some(phrase => normalized.includes(phrase));
      }

      // Seguridad: validar que los datos clave existen
      if (!customer.business_email || !customer.whatsapp || !customer.business_name || !customer.services) {
        console.warn("⚠️ Cliente con datos incompletos:", customer);
        await client.messages.create({
          from: to,
          to: from,
          body: "Este número está activo, pero no tiene toda la información configurada aún. Por favor, contacta al administrador."
        });
        return;
      }

      // Seguridad: valores por defecto si faltan
      if (!customer.business_email) customer.business_email = "soporte@tuchatbot.com";
      if (!customer.whatsapp) customer.whatsapp = "+1XXXXXXXXXX";

      // Detectar si es el primer mensaje (saludo breve)
      const isFirstMessage = /^(hola|buenas\s(noches|tardes|días)?)/i.test(message.trim());

      const now = Date.now();
      const last = lastInteraction.get(from);

      // Si el último mensaje fue un saludo y fue hace menos de 60 segundos, no repetir
      if (
        isFirstMessage &&
        last &&
        last.type === "greeting" &&
        now - last.timestamp < 60000
      ) {
        return; // No responder el mismo saludo tan pronto
      }

      // Detectar si el mensaje es demasiado general
      if (isStrongInfoIntentBilingual(message)) {
        await sendLongMessageInChunks(from, to, customer.services, isEnglish(message));
        return;
      }

      function isEnglish(message) {
        const englishKeywords = [
          "hi", "hello", "how much", "price", "program", "english", "yes", "i want", "information", "start", "register", "book"
        ];

        const normalized = message.toLowerCase();
        return englishKeywords.some(word => normalized.includes(word));
      }

      const prompt = isMsgEnglish ? `
      You are the virtual assistant of the business "${customer.business_name}".

      This business offers the following services:
      ${customer.services}

      Business hours: ${customer.opening_hours}.

      Your job is to respond to the following customer message clearly, professionally, and helpfully:
      "${message}"

      ⚠️ Important instructions:
      - Reply in one message only
      - Be direct but friendly
      - Only mention the business hours if relevant
      - Use only the information provided in the services
      - If the customer sends a general message like "I want more information", "I'm interested", or "I'd like to know more", etc., avoid providing all the details at once.
        Instead, respond with a helpful and welcoming question that encourages the customer to be more specific, such as:
        "Of course, I'd be happy to help. What would you like to know more about? For example: prices, program details, duration, or payment methods."
      - Only include this at the end **if the customer wants to register, book an appointment, or speak to someone**:
        "For more information, you can contact us at ${customer.business_email} or via WhatsApp at ${customer.whatsapp}"
      ` : `
      Eres el asistente virtual del negocio "${customer.business_name}".

      Este negocio ofrece los siguientes servicios:
      ${customer.services}

      Horario de atención: ${customer.opening_hours}.

      Tu tarea es responder al siguiente mensaje del cliente de forma clara, profesional y útil:
      "${message}"

      ⚠️ Instrucciones importantes:
      - Responde en un solo mensaje
      - Sé directo pero amable
      - Solo menciona el horario si es relevante
      - Usa únicamente la información proporcionada en los servicios
      - Si el cliente envía un mensaje general como "quiero más información", "me interesa", o "quisiera saber más", etc., no proporciones toda la información de inmediato.
        En su lugar, responde con una frase que demuestre disposición a ayudar y que oriente al cliente a especificar su interés, como:
        "Claro, estaré encantado(a) de ayudarte. ¿Qué te gustaría saber con más detalle? Por ejemplo: precios, duración, qué incluye o métodos de pago."
      - Solo incluye esta línea al final si el cliente desea inscribirse, agendar una cita o hablar con alguien:
        "Para más información, puedes contactarnos al correo ${customer.business_email} o por WhatsApp al ${customer.whatsapp}"
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }]
      });

      reply = completion.choices[0].message.content.trim();

      // Agregar contacto solo si el modelo NO lo agregó ya
      const contactoTexto = `${customer.business_email} ${customer.whatsapp}`;

      // Detectar y eliminar contacto si no hay intención de compra
      if (!isReadyToBuy(message)) {
        const contactoRegex = isMsgEnglish
          ? /for more information[\s\S]*?(\n|\r|$)/i
          : /para más información[\s\S]*?(\n|\r|$)/i;

        reply = reply.replace(contactoRegex, "").trim();

        // Eliminar signos sueltos al final
        reply = reply.replace(/[,\.!]+$/, "").trim();
      }

      // Si hay múltiples párrafos, tomar solo el primero
      const replyParts = reply.split(/\n{2,}/);
      reply = replyParts[0].trim();

      // Si es un primer saludo, personalizar respuesta según idioma
      if (isFirstMessage) {
        reply = isMsgEnglish
          ? `Hello! 👋 Welcome to ${customer.business_name}. How can I assist you today?`
          : `¡Hola! 👋 Bienvenido(a) a ${customer.business_name}. ¿Cómo puedo ayudarte hoy?`;

        lastInteraction.set(from, { type: "greeting", timestamp: now });
      }

      // Si el mensaje es un agradecimiento
      if (isGratitudeMessage(message)) {
        reply = isMsgEnglish
          ? "You're welcome! 😊 Let me know if you need anything else."
          : "¡Con gusto! 😊 Si necesitas algo más, aquí estaré.";
      }

      // Eliminar saludos si NO es el primer mensaje
      if (!isFirstMessage) {
        reply = reply.replace(/^(\s*[¡!]?\s*hola[¡!\.,]?\s*)/i, "");
        reply = reply.replace(/^(\s*buenas\s(noches|tardes|días)[\.,!\s]*)/i, "");
      }

      // Limpieza de comas o signos solitarios al inicio
      reply = reply.replace(/^(\s*[,\.!])+\s*/g, "");

      // Capitalizar primera letra
      if (reply.length > 0) {
        reply = reply[0].toUpperCase() + reply.slice(1);
      }

      // Corregir cortes como "¡Gracias" sin cerrar
      reply = reply.replace(/\b¡Gracias\b\.?$/, "").trim();

      // Agregar punto final si no termina en puntuación o emoji
      const endsWithEmojiOrPunctuation = /[\u{1F300}-\u{1FAD6}\u{1F600}-\u{1F64F}\u{2700}-\u{27BF}.!?]$/u;
      if (!endsWithEmojiOrPunctuation.test(reply)) {
        reply += ".";
      }

      // Verifica que la respuesta no esté vacía
      if (!reply || reply.length < 3) {
        console.warn("⚠️ Respuesta vacía o inválida");
        return;
      }

      console.log("🧾 Enviando solo esto a Twilio:", reply);

            await client.messages.create({
              from: to,
              to: from,
              body: reply
            });

          } catch (err) {
            console.error("❌ Error procesando mensaje (diferido):", err);
          }
        }, 0); // cerrar setTimeout
      }); // cerrar app.post('/webhook'...)

app.post('/api/assign-number', async (req, res) => {
  const { whatsapp, twilioNumber } = req.body;

  if (!whatsapp || !twilioNumber) {
    return res.status(400).json({ error: 'Falta el número de WhatsApp o Twilio' });
  }

  try {
    const existing = await db.query('SELECT * FROM clients WHERE whatsapp = $1', [whatsapp]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    await db.query(
      'UPDATE clients SET twilio_number = $1 WHERE whatsapp = $2',
      [twilioNumber, whatsapp]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al asignar número:", err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
app.get('/api/clients', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM clients ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error al obtener clientes:", err);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor iniciado en puerto ${PORT}`));
