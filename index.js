import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import twilio from 'twilio';
import pkg from 'pg';
import { twiml as TwilioTwiml } from 'twilio';

const { Pool } = pkg;

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

      const prompt = `
      Eres el asistente virtual de "${customer.business_name}", un negocio que ofrece: ${customer.services}.
      Tu tarea es responder preguntas de clientes de forma educada, profesional y útil.

      ⚠️ IMPORTANTE:
      - Solo responde **una vez**
      - No saludes dos veces
      - No digas "OK" ni "Hola" innecesariamente
      - No cierres con "¿En qué más puedo ayudarte?" a menos que sea natural

      Horario del negocio: ${customer.opening_hours}.

      Mensaje del cliente:
      "${message}"

      Responde como si fueras parte del equipo del negocio, en un solo mensaje claro y directo.
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }]
      });

      let reply = completion.choices[0].message.content.trim();

      // Limpiar respuesta
      const replyParts = reply.split(/\n{2,}/);
      reply = replyParts[0].trim();
      reply = reply.replace(/^ok[\.\!\s\n]*/i, "");
      reply = reply.replace(/^hola[\.\!\s\n]*/i, "");
      reply = reply.replace(/^\s*\n+/, "");
      reply = reply.trim();

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor iniciado en puerto ${PORT}`));
