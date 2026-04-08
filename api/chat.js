module.exports = async function handler(req, res) {
  // =============================================
  // CORS
  // =============================================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('[FinanceFlow] GEMINI_API_KEY not found');
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  // =============================================
  // FUNCAO DE ESPERA (para retry)
  // =============================================
  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // =============================================
  // RESPOSTAS FALLBACK AMIGAVEIS
  // (quando tudo falha, o usuario ainda recebe algo util)
  // =============================================
  var fallbackResponses = {
    rateLimit:
      '⏳ Estou recebendo muitas perguntas agora! Aguarde uns 10 segundos e tente novamente.',
    timeout:
      '⏱️ Demorei demais para responder. Tente uma pergunta mais curta e direta, por exemplo: "Como economizar no mercado?"',
    safety:
      '🔒 Nao posso responder sobre esse assunto. Sou especializado em financas pessoais! Pergunte sobre gastos, economia ou planejamento.',
    blocked:
      '🚫 Essa pergunta foi bloqueada pelo filtro de seguranca. Tente reformular! Posso te ajudar com analise de gastos, dicas de economia ou metas financeiras.',
    empty:
      '🤔 Nao consegui gerar uma resposta. Tente reformular! Exemplos:\n\n💡 "Analise meus gastos"\n💡 "Como fazer sobrar dinheiro?"\n💡 "Onde posso economizar?"',
    format:
      '😅 Nao entendi o formato da pergunta. Tente algo como: "Quanto estou gastando por mes?" ou "Me da dicas para economizar"',
    network:
      '🌐 Problema de conexao com o servico de IA. Verifique sua internet e tente novamente.',
    generic:
      '⚠️ Tive um problema tecnico. Tente novamente em alguns segundos! Se persistir, recarregue a pagina.'
  };

  // =============================================
  // SYSTEM INSTRUCTION COMPLETO E ROBUSTO
  // =============================================
  function buildSystemInstruction(context) {
    var parts = [
      'Voce e o ASSISTENTE FINANCEIRO INTELIGENTE do FinanceFlow, o app de controle financeiro pessoal.',
      '',
      '═══════════════════════════════════',
      'SUA PERSONALIDADE',
      '═══════════════════════════════════',
      '- Voce e como um amigo que entende muito de financas e fala de forma simples',
      '- Sempre positivo e encorajador, NUNCA julgue os gastos do usuario',
      '- Comemore conquistas ("Parabens! Voce economizou X esse mes!")',
      '- Use humor leve quando apropriado para tornar financas menos chatas',
      '- Seja empatico quando o usuario estiver com dificuldades financeiras',
      '',
      '═══════════════════════════════════',
      'IDIOMA E FORMATO',
      '═══════════════════════════════════',
      '- Responda SEMPRE em portugues do Brasil',
      '- Use **negrito** para destacar valores e pontos-chave',
      '- Formate valores: R$ 1.500,00 (ponto nos milhares, virgula nos centavos)',
      '- Use emojis com moderacao para organizar: 💡 dica, 🔴 alerta, 🟢 positivo, 📊 dados, 💰 dinheiro, ⚡ acao',
      '- Paragrafos curtos (2-3 linhas no maximo)',
      '- Respostas entre 100 e 400 palavras dependendo da complexidade',
      '- NAO use titulos com # ou ###, use emojis e **negrito** para organizar',
      '- NAO repita a pergunta do usuario na resposta',
      '',
      '═══════════════════════════════════',
      'SUAS ESPECIALIDADES',
      '═══════════════════════════════════',
      '1. 📊 ANALISE DE GASTOS: Identificar padroes, comparar categorias, mostrar evolucao',
      '2. 💡 DICAS DE ECONOMIA: Sugestoes praticas e aplicaveis ao contexto brasileiro',
      '3. 🔴 ALERTAS: Contas proximas do vencimento, gastos acima da media',
      '4. 🎯 METAS: Reserva de emergencia, objetivos financeiros, poupanca',
      '5. 📈 PLANEJAMENTO: Orcamento mensal, regra 50-30-20, divisao de gastos',
      '6. 🧠 EDUCACAO: Conceitos financeiros (juros compostos, inflacao, Selic) de forma simples',
      '',
      '═══════════════════════════════════',
      'REGRAS INVIOLAVEIS',
      '═══════════════════════════════════',
      '- Use APENAS os dados fornecidos, NUNCA invente numeros ou transacoes',
      '- Se nao tem dados suficientes, diga: "Cadastre suas contas no app para eu poder te ajudar melhor!"',
      '- NUNCA recomende investimentos especificos (acoes, cripto, fundos com nome)',
      '- NUNCA fale sobre assuntos fora de financas pessoais por mais de 1 frase',
      '- Considere o contexto brasileiro: IPCA, Selic, INSS, FGTS, vale-refeicao, etc.',
      '- Se nao sabe a resposta, diga honestamente e sugira onde buscar (ex: "consulte um contador")',
      '- Quando der dicas, inclua o impacto estimado em R$ quando possivel',
      '',
      '═══════════════════════════════════',
      'DADOS FINANCEIROS DO USUARIO',
      '═══════════════════════════════════',
      (context && context.trim() !== ''
        ? context
        : 'Nenhum dado cadastrado ainda. Incentive o usuario a cadastrar suas contas, despesas e receitas para receber analises personalizadas.')
    ];
    return parts.join('\n');
  }

  // =============================================
  // VALIDACAO E LIMPEZA DAS MENSAGENS
  // (resolve os erros 400 do Gemini)
  // =============================================
  function cleanMessages(messages) {
    if (!messages || !Array.isArray(messages)) return [];

    var recent = messages.slice(-15);

    // 1. Filtra mensagens invalidas ou vazias
    var valid = [];
    for (var i = 0; i < recent.length; i++) {
      var msg = recent[i];
      if (
        msg &&
        typeof msg.content === 'string' &&
        msg.content.trim() !== '' &&
        (msg.role === 'user' || msg.role === 'assistant')
      ) {
        valid.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content.trim().substring(0, 4000) }]
        });
      }
    }

    if (valid.length === 0) return [];

    // 2. Primeira mensagem DEVE ser 'user' (exigencia Gemini)
    while (valid.length > 0 && valid[0].role !== 'user') {
      valid.shift();
    }

    // 3. Mensagens devem ALTERNAR user/model (exigencia Gemini)
    //    Se duas consecutivas tem o mesmo role, COMBINA o texto
    var alternated = [];
    for (var j = 0; j < valid.length; j++) {
      if (alternated.length === 0) {
        alternated.push(valid[j]);
      } else {
        var lastMsg = alternated[alternated.length - 1];
        if (valid[j].role === lastMsg.role) {
          lastMsg.parts[0].text += '\n' + valid[j].parts[0].text;
        } else {
          alternated.push(valid[j]);
        }
      }
    }

    // 4. Ultima mensagem DEVE ser 'user' (exigencia Gemini)
    while (alternated.length > 0 && alternated[alternated.length - 1].role !== 'user') {
      alternated.pop();
    }

    return alternated;
  }

  // =============================================
  // CHAMADA AO GEMINI COM RETRY INTELIGENTE
  // (ate 3 tentativas com espera progressiva)
  // =============================================
  async function callGemini(systemInstruction, contents, attempt) {
    if (!attempt) attempt = 1;
    var maxAttempts = 3;

    var url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
      apiKey;

    var controller;
    var timeoutId;

    try {
      // Timeout progressivo: 30s, 45s, 60s
      var timeoutMs = 30000 + (attempt - 1) * 15000;
      controller = new AbortController();
      timeoutId = setTimeout(function () {
        controller.abort();
      }, timeoutMs);

      var response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: contents,
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.7,
            topP: 0.9,
            topK: 40
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
          ]
        })
      });

      clearTimeout(timeoutId);

      // ----- RATE LIMIT (429) -----
      if (response.status === 429) {
        console.warn('[FinanceFlow] Rate limit, tentativa ' + attempt + '/' + maxAttempts);
        if (attempt < maxAttempts) {
          await wait(attempt * 3000);
          return callGemini(systemInstruction, contents, attempt + 1);
        }
        return { ok: false, type: 'rateLimit' };
      }

      // ----- ERRO 400 (formato) -----
      if (response.status === 400) {
        var errBody = '';
        try { errBody = await response.text(); } catch (e) { /* ignore */ }
        console.error('[FinanceFlow] Bad request:', errBody);
        return { ok: false, type: 'format' };
      }

      // ----- ERRO 403 (api key) -----
      if (response.status === 403) {
        console.error('[FinanceFlow] API key invalid');
        return { ok: false, type: 'auth' };
      }

      // ----- ERRO 500+ (servidor Gemini) -----
      if (response.status >= 500) {
        console.error('[FinanceFlow] Gemini server error:', response.status);
        if (attempt < maxAttempts) {
          await wait(attempt * 2000);
          return callGemini(systemInstruction, contents, attempt + 1);
        }
        return { ok: false, type: 'generic' };
      }

      // ----- OUTRO ERRO HTTP -----
      if (!response.ok) {
        console.error('[FinanceFlow] Unexpected HTTP:', response.status);
        if (attempt < maxAttempts) {
          await wait(attempt * 2000);
          return callGemini(systemInstruction, contents, attempt + 1);
        }
        return { ok: false, type: 'generic' };
      }

      // ----- SUCESSO: PARSE RESPOSTA -----
      var data = await response.json();

      // Prompt bloqueado antes de gerar
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        console.warn('[FinanceFlow] Prompt blocked:', data.promptFeedback.blockReason);
        return { ok: false, type: 'blocked' };
      }

      // Sem candidates
      if (!data.candidates || data.candidates.length === 0) {
        console.warn('[FinanceFlow] No candidates');
        if (attempt < maxAttempts) {
          await wait(attempt * 1500);
          return callGemini(systemInstruction, contents, attempt + 1);
        }
        return { ok: false, type: 'empty' };
      }

      var candidate = data.candidates[0];

      // Bloqueado por seguranca
      if (candidate.finishReason === 'SAFETY') {
        return { ok: false, type: 'safety' };
      }
      if (candidate.finishReason === 'RECITATION') {
        return { ok: false, type: 'blocked' };
      }

      // Resposta cortada mas ainda utilizavel
      if (candidate.finishReason === 'MAX_TOKENS') {
        console.warn('[FinanceFlow] Response truncated (MAX_TOKENS)');
      }

      // Extrai texto
      if (candidate.content && candidate.content.parts) {
        var reply = candidate.content.parts
          .map(function (p) { return p.text || ''; })
          .join('\n')
          .trim();

        if (reply.length > 0) {
          return { ok: true, reply: reply };
        }
      }

      // Resposta vazia — retry
      if (attempt < maxAttempts) {
        await wait(attempt * 1500);
        return callGemini(systemInstruction, contents, attempt + 1);
      }
      return { ok: false, type: 'empty' };

    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);

      // Timeout
      if (err.name === 'AbortError') {
        console.error('[FinanceFlow] Timeout, tentativa ' + attempt + '/' + maxAttempts);
        if (attempt < maxAttempts) {
          await wait(1000);
          return callGemini(systemInstruction, contents, attempt + 1);
        }
        return { ok: false, type: 'timeout' };
      }

      // Erro de rede
      console.error('[FinanceFlow] Network error:', err.message);
      if (attempt < maxAttempts) {
        await wait(attempt * 2000);
        return callGemini(systemInstruction, contents, attempt + 1);
      }
      return { ok: false, type: 'network' };
    }
  }

  // =============================================
  // HANDLER PRINCIPAL
  // =============================================
  try {
    var body = req.body || {};
    var messages = body.messages;
    var context = body.context;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages array' });
    }

    // Limpa e valida mensagens
    var contents = cleanMessages(messages);
    if (contents.length === 0) {
      return res.status(200).json({
        reply: '💬 Nao recebi sua mensagem. Digite algo como "Analise meus gastos" ou "Como economizar?"'
      });
    }

    // Monta system instruction
    var systemInstruction = buildSystemInstruction(context);

    // Chama Gemini com retry automatico
    var result = await callGemini(systemInstruction, contents);

    if (result.ok) {
      return res.status(200).json({ reply: result.reply });
    }

    // Erro de autenticacao = erro real
    if (result.type === 'auth') {
      return res.status(500).json({ error: 'API key invalida ou expirada' });
    }

    // Qualquer outro erro = mensagem amigavel
    var fallback = fallbackResponses[result.type] || fallbackResponses.generic;
    return res.status(200).json({ reply: fallback });

  } catch (err) {
    console.error('[FinanceFlow] Unhandled error:', err.message || err);
    return res.status(200).json({ reply: fallbackResponses.generic });
  }
};
