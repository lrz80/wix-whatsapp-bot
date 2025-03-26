import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import twilio from 'twilio';
import pkg from 'pg';

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
  const from = req.body.From; // quién escribe
  const to = req.body.To;     // a qué número escribieron
  const message = req.body.Body;

  console.log("📩 Mensaje:", message);
  console.log("📲 De:", from);
  console.log("📥 A:", to);

  if (!to || !to.startsWith("whatsapp:")) {
    console.error("❌ Número receptor inválido:", to);
    return res.status(400).send("Número destino inválido");
  }

  try {
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
      return res.sendStatus(200);
    }

    const customer = result.rows[0];

    const prompt = `
Eres el chatbot del negocio "${customer.business_name}". 
Atiendes con amabilidad, usando respuestas breves y claras.
Horario: ${customer.opening_hours}.
Servicios ofrecidos: ${customer.services}.
Responde al cliente: "${message}"
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }]
    });

    const reply = completion.choices[0].message.content;

    await client.messages.create({
      from: to,
      to: from,
      body: reply
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en webhook dinámico:", err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor iniciado en puerto ${PORT}`));
