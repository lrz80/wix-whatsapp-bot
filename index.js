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

      // Detectar si el mensaje es demasiado general
      if (isGenericInfoRequest(message)) {
        reply = "¿Qué te gustaría saber? Por ejemplo: precios, qué incluye, duración, formas de pago, etc.";
        await client.messages.create({ from: to, to: from, body: reply });
        return;
      }

      function isEnglish(message) {
        const englishKeywords = [
          "hi", "hello", "how much", "price", "program", "english", "yes", "i want", "information", "start", "register", "book"
        ];

        const normalized = message.toLowerCase();
        return englishKeywords.some(word => normalized.includes(word));
      }

      const isMsgEnglish = isEnglish(message);

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
      - If the customer says something general like "I want more information", "I'm interested", etc., do NOT answer everything. Instead, reply with:
        "What would you like to know? For example: prices, what's included, duration, payment methods, etc."
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
      - Si el cliente dice algo muy general como "quiero más información", "me interesa", etc., NO respondas todo. En su lugar, responde con:
        "¿Qué te gustaría saber? Por ejemplo: precios, qué incluye, duración, formas de pago, etc."
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

      // Si NO hay intención de compra y el mensaje ya contiene contacto → eliminarlo
      if (!isReadyToBuy(message) && reply.includes(customer.business_email)) {
        reply = reply.replace(/para más información.*?${customer.whatsapp}/i, "").trim();
      }

    }

      // Si hay múltiples párrafos, tomar solo el primero
      const replyParts = reply.split(/\n{2,}/);
      reply = replyParts[0].trim();

      // Limpieza de saludos (solo si NO es primer mensaje)
      if (!isFirstMessage) {
        reply = reply.replace(/^(hola|ok)[\.,!\s]*/i, "");
        reply = reply.replace(/^buenas\s(noches|tardes|días)[\.,!\s]*/i, "");
      }

      // Limpieza de comas o signos solitarios
      reply = reply.replace(/^(\s*[,\.!])+\s*/g, "");

      // Capitaliza primera letra
      if (reply.length > 0) {
        reply = reply[0].toUpperCase() + reply.slice(1);
      }

      reply = reply.trim();

      // Validar contenido
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
  }, 0);
});

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
