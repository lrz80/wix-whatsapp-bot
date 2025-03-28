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
  const { businessName, ownerName, whatsappNumber, openingHours, services, twilioNumber } = req.body;

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
          services = $4
          ${twilioNumber ? ', twilio_number = $5' : ''}
        WHERE whatsapp = $${twilioNumber ? 6 : 5}`,
        twilioNumber
          ? [businessName, ownerName, openingHours, services, twilioNumber, whatsappNumber]
          : [businessName, ownerName, openingHours, services, whatsappNumber]
      );
    } else {
      await db.query(
        `INSERT INTO clients (whatsapp, business_name, owner_name, opening_hours, services${twilioNumber ? ', twilio_number' : ''})
         VALUES ($1, $2, $3, $4, $5${twilioNumber ? ', $6' : ''})`,
        twilioNumber
          ? [whatsappNumber, businessName, ownerName, openingHours, services, twilioNumber]
          : [whatsappNumber, businessName, ownerName, openingHours, services]
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
      "quiero información",
      "quiero info",
      "dame información",
      "dame info",
      "me interesa",
      "más info",
      "información por favor",
      "necesito info",
      "envíame información",
      "quiero saber más",
      "quiero detalles",
      "puedes darme info",
      "cuéntame más",
      "necesito más información"
    ];

    return genericPhrases.some(phrase => normalized.includes(phrase));
  }

    try {
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

      if (isGenericInfoRequest(message)) {
        reply = "¿Qué te gustaría saber? Por ejemplo: precios, qué incluye, duración, formas de pago, etc.";

        // Enviar esa respuesta directamente a WhatsApp
        await client.messages.create({
          from: to,
          to: from,
          body: reply
        });

        return; // detener el flujo, no llamar a OpenAI
      }

      const prompt = `
      Eres el asistente virtual del negocio "${customer.business_name}".

      Este negocio ofrece los siguientes servicios:
      ${customer.services}

      Horario de atención: ${customer.opening_hours}.

      Tu tarea es responder al siguiente mensaje del cliente de forma clara, profesional y útil:
      "${message}"

      ⚠️ Instrucciones importantes:
      - Responde en un solo mensaje
      - Solo incluye saludos como "Hola", "Hola Buenas noches" en el primer mensaje.
      - Sé directo pero amable
      - Solo menciona el horario si es relevante
      - Utiliza únicamente la información proporcionada en los servicios
      - Si el cliente dice algo muy general como "quiero más información", "me interesa", "dame info", etc., NO respondas con toda la información de inmediato. En su lugar, responde algo como:
        "¿Qué te gustaría saber? Por ejemplo: precios, qué incluye, duración, formas de pago, etc."
      - Solo incluye esta línea al final si el cliente desea inscribirse, agendar una cita o hablar con alguien:
        "Para más información, puedes contactarnos al correo ${customer.email} o por WhatsApp al ${customer.whatsapp}"
`      ;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }]
      });

      // Define si es el primer mensaje (puedes ajustar esta lógica luego)
      const isFirstMessage = /^(hola|buenas\s(noches|tardes|días)?)/i.test(message.trim());

      // Obtiene respuesta del modelo
      let reply = completion.choices[0].message.content.trim();

      // Si hay múltiples párrafos, tomamos solo el primero
      const replyParts = reply.split(/\n{2,}/);
      reply = replyParts[0].trim();

      // Limpieza de saludos (solo si no es el primer mensaje)
      if (!isFirstMessage) {
        reply = reply.replace(/^(hola|ok)[\.,!\s]*/i, "");
        reply = reply.replace(/^buenas\s(noches|tardes|días)[\.,!\s]*/i, "");
      }

      // Limpia comas o signos sueltos al inicio
      reply = reply.replace(/^(\s*[,\.!])+\s*/g, "");

      // Capitaliza la primera letra
      if (reply.length > 0) {
        reply = reply[0].toUpperCase() + reply.slice(1);
      }

      reply = reply.trim();

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
