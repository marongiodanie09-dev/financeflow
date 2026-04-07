module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('GEMINI_API_KEY not found in environment variables');
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  try {
    const { messages, context } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages' });
    }

    const systemInstruction = `Voce e o assistente financeiro do FinanceFlow, um app de controle financeiro pessoal.

REGRAS:
- Responda SEMPRE em portugues do Brasil
- Seja direto, pratico e amigavel
- Use dados concretos do usuario para personalizar as respostas
- De dicas especificas baseadas nos gastos reais
- Formate valores em R$ (reais)
- Use **negrito** para destacar valores e pontos importantes
- Mantenha respostas curtas (maximo 200 palavras)
- Nao invente dados que nao foram fornecidos
- Se o usuario nao tem dados, sugira que cadastre suas contas primeiro
- Foque em: analise de gastos, dicas de economia, alertas sobre atrasos, planejamento

DADOS ATUAIS DO USUARIO:
${context || 'Nenhum dado disponivel.'}`;

    var recentMessages = messages.slice(-10);

    var contents = recentMessages.map(function(msg) {
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      };
    });

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;

    var response = await fetch(url, {
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
    });

    if (!response.ok) {
      var errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      return res.status(500).json({ error: 'AI service error: ' + response.status });
    }

    var data = await response.json();

    var reply = 'Sem resposta.';

    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
      reply = data.candidates[0].content.parts
        .map(function(p) { return p.text; })
        .join('\n');
    }

    return res.status(200).json({ reply: reply });

  } catch (err) {
    console.error('Chat API error:', err.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
