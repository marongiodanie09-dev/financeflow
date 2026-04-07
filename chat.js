export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  try {
    const { messages, context } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages' });
    }

    const systemInstruction = `Você é o assistente financeiro do FinanceFlow, um app de controle financeiro pessoal.

REGRAS:
- Responda SEMPRE em português do Brasil
- Seja direto, prático e amigável
- Use dados concretos do usuário para personalizar as respostas
- Dê dicas específicas baseadas nos gastos reais
- Formate valores em R$ (reais)
- Use **negrito** para destacar valores e pontos importantes
- Mantenha respostas curtas (máximo 200 palavras)
- Não invente dados que não foram fornecidos
- Se o usuário não tem dados, sugira que cadastre suas contas primeiro
- Foque em: análise de gastos, dicas de economia, alertas sobre atrasos, planejamento

DADOS ATUAIS DO USUÁRIO:
${context}`;

    // Convert message history to Gemini format
    const recentMessages = messages.slice(-10);

    const contents = recentMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: contents,
          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.7
          }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Gemini API error:', errorData);
      return res.status(500).json({ error: 'AI service error' });
    }

    const data = await response.json();

    const reply = data.candidates?.[0]?.content?.parts
      ?.map(p => p.text)
      .join('\n') || 'Sem resposta.';

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
