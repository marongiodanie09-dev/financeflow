// =============================================
// FINANCE FLOW - CHAT IA BLINDADO v4
// Gemini (primario) + ChatGPT (fallback) + cache + offline
// =============================================

// Cache em memoria para evitar chamadas repetidas
var responseCache = {};
var CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// Controle de cooldown por modelo
var modelCooldowns = {};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var geminiKey = process.env.GEMINI_API_KEY;
  var openaiKey = process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    return res.status(500).json({ error: 'Nenhuma API key configurada' });
  }

  // =============================================
  // MODELOS EM ORDEM DE PREFERENCIA
  // Gemini primeiro (gratis), ChatGPT por ultimo (pago)
  // =============================================
  var GEMINI_MODELS = [
    'gemini-2.0-flash',       // 15 RPM free — principal
    'gemini-2.0-flash-lite',  // 30 RPM free — mais leve, mais quota
    'gemini-1.5-flash'        // 15 RPM free — fallback estavel
  ];

  var OPENAI_MODEL = 'gpt-4o-mini'; // Barato e rapido — so usa se Gemini falhar

  // =============================================
  // UTILIDADES
  // =============================================
  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function getCacheKey(text) {
    return text.toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 200);
  }

  function getCachedResponse(key) {
    var cached = responseCache[key];
    if (cached && Date.now() - cached.time < CACHE_TTL) return cached.reply;
    if (cached) delete responseCache[key];
    return null;
  }

  function setCachedResponse(key, reply) {
    var keys = Object.keys(responseCache);
    if (keys.length > 50) delete responseCache[keys[0]];
    responseCache[key] = { reply: reply, time: Date.now() };
  }

  function isModelOnCooldown(model) {
    var cd = modelCooldowns[model];
    if (cd && Date.now() < cd) return true;
    if (cd) delete modelCooldowns[model];
    return false;
  }

  function setModelCooldown(model, seconds) {
    modelCooldowns[model] = Date.now() + seconds * 1000;
  }

  // =============================================
  // RESPOSTAS OFFLINE INTELIGENTES
  // Quando TODOS os modelos falham, responde
  // localmente baseado em palavras-chave
  // =============================================
  function getOfflineResponse(userMessage, context) {
    var msg = (userMessage || '').toLowerCase();

    if (msg.match(/economi[zs]ar|gastar menos|sobrar|poupar|cortar/)) {
      return '💡 **Dicas rapidas para economizar:**\n\n'
        + '1. 📋 Anote TODOS os gastos por 30 dias — so de rastrear, voce ja reduz 10-15%\n'
        + '2. 🛒 Faca lista antes de ir ao mercado e nao va com fome\n'
        + '3. 📱 Cancele assinaturas que nao usa (Netflix, Spotify, apps)\n'
        + '4. 🍳 Cozinhe mais em casa — restaurante custa 3-5x mais\n'
        + '5. 💧 Reduza luz: banho curto, apague luzes, ar-condicionado com timer\n\n'
        + '⚡ Cadastre suas contas no app para dicas PERSONALIZADAS!';
    }

    if (msg.match(/analis|gastos|gastando|despesa|resumo|relatorio/)) {
      if (context && context.trim() && context !== 'Nenhum dado disponivel.') {
        return '📊 **Seus dados estao cadastrados!**\n\n'
          + 'O servidor esta ocupado agora, mas aqui vai uma dica:\n\n'
          + '💡 Revise seus gastos VARIAVEIS — sao os mais faceis de reduzir. '
          + 'Alimentacao fora, transporte por app e lazer geralmente sao os campeoes.\n\n'
          + '🔄 Tente novamente em 30 segundos para analise completa com IA!';
      }
      return '📊 Para analisar seus gastos, cadastre suas contas e despesas no app primeiro! '
        + 'Assim consigo te dar um diagnostico completo com dicas personalizadas. 💡';
    }

    if (msg.match(/divida|devendo|devo|atrasa|pagar conta|quitar|concerto|conserto/)) {
      return '🔴 **Sobre dividas, priorize assim:**\n\n'
        + '1. **Essenciais primeiro:** aluguel, luz, agua, alimentacao\n'
        + '2. **Juros altos depois:** cartao de credito, cheque especial\n'
        + '3. **Negocie:** ligue pro credor e peca desconto pra pagar a vista\n\n'
        + '💡 **Dica:** O Serasa Limpa Nome e mutiroes de negociacao podem reduzir dividas em ate 90%!\n\n'
        + '📌 Se voce recebe menos do que deve, foque primeiro em:\n'
        + '- Cortar TODO gasto nao essencial temporariamente\n'
        + '- Buscar renda extra (bico, freelance, vender algo)\n'
        + '- Negociar parcelas menores com credores\n\n'
        + '🔄 Tente novamente em 30s para resposta personalizada!';
    }

    if (msg.match(/reserva|emergencia|guardar|investir|poupan/)) {
      return '🎯 **Reserva de Emergencia:**\n\n'
        + 'O ideal e ter **3 a 6 meses** de gastos essenciais guardados.\n\n'
        + '💡 Comece pequeno: **R$ 50 por semana** = R$ 2.600 em 1 ano!\n\n'
        + 'Onde guardar:\n'
        + '- **Tesouro Selic** — rende mais que poupanca, pode sacar quando quiser\n'
        + '- **CDB liquidez diaria** — similar, veja no seu banco\n\n'
        + '🔄 Tente novamente em 30s para dicas baseadas nos seus dados!';
    }

    if (msg.match(/renda extra|ganhar mais|bico|freelance/)) {
      return '💰 **Ideias de renda extra:**\n\n'
        + '1. 🚗 Motorista de app (Uber, 99) nos horarios de pico\n'
        + '2. 📦 Entregas (iFood, Rappi)\n'
        + '3. 💻 Freelance na sua area (Workana, 99freelas)\n'
        + '4. 🛍️ Vender coisas que nao usa (OLX, Enjoei)\n'
        + '5. 📚 Aulas particulares do que voce sabe\n'
        + '6. 🎨 Rifas e artesanato\n\n'
        + '💡 Qualquer R$ 500 extra por mes = R$ 6.000 por ano!';
    }

    if (msg.match(/oi|ola|bom dia|boa tarde|boa noite|hey|eai|tudo bem/)) {
      return '👋 Ola! Sou o assistente financeiro do FinanceFlow!\n\n'
        + 'Posso te ajudar com:\n'
        + '💰 Analisar seus gastos\n'
        + '💡 Dicas para economizar\n'
        + '🎯 Metas de poupanca\n'
        + '📊 Planejamento financeiro\n'
        + '🔴 Ajuda com dividas\n\n'
        + 'O que voce gostaria de saber?';
    }

    if (msg.match(/obrigad|valeu|thanks|brigad/)) {
      return '😊 De nada! Fico feliz em ajudar!\n\n'
        + 'Se precisar de mais alguma coisa sobre suas financas, e so perguntar. '
        + 'Lembre-se de manter seus dados atualizados no app para dicas cada vez melhores! 💡';
    }

    // Fallback generico
    return '💡 Estou com dificuldade para acessar a IA agora, mas posso te dizer que as **3 maiores formas de economizar** sao:\n\n'
      + '1. 🍽️ Reduzir alimentacao fora de casa\n'
      + '2. 📱 Renegociar contas fixas (internet, celular, seguro)\n'
      + '3. ✂️ Cortar assinaturas nao essenciais\n\n'
      + '🔄 Tente sua pergunta novamente em 30 segundos para resposta personalizada com IA!';
  }

  // =============================================
  // SYSTEM INSTRUCTION (compartilhado Gemini + OpenAI)
  // =============================================
  function buildSystemInstruction(context) {
    return [
      'Voce e o ASSISTENTE FINANCEIRO do FinanceFlow.',
      '',
      'PERSONALIDADE: Amigavel, direto, pratico. Como um amigo que entende de financas.',
      'Nunca julgue gastos. Seja encorajador. Use humor leve.',
      '',
      'FORMATO:',
      '- Portugues do Brasil SEMPRE',
      '- **negrito** para valores e pontos-chave',
      '- Valores em R$ (ex: R$ 1.500,00)',
      '- Emojis moderados: 💡🔴🟢📊💰⚡',
      '- Paragrafos curtos, 100-400 palavras',
      '- NAO use ### titulos markdown',
      '',
      'ESPECIALIDADES: Analise de gastos, dicas de economia, alertas de contas, metas, orcamento, educacao financeira.',
      '',
      'REGRAS:',
      '- Use APENAS dados fornecidos, nunca invente',
      '- Sem dados = sugira cadastrar no app',
      '- Nunca recomende investimentos especificos',
      '- Contexto brasileiro (Selic, IPCA, FGTS)',
      '- Inclua impacto em R$ quando possivel',
      '',
      'DADOS DO USUARIO:',
      (context && context.trim() ? context : 'Nenhum dado cadastrado.')
    ].join('\n');
  }

  // =============================================
  // LIMPA MENSAGENS PARA GEMINI
  // =============================================
  function cleanMessagesGemini(messages) {
    if (!messages || !Array.isArray(messages)) return [];

    var recent = messages.slice(-12);
    var valid = [];

    for (var i = 0; i < recent.length; i++) {
      var msg = recent[i];
      if (msg && typeof msg.content === 'string' && msg.content.trim() &&
          (msg.role === 'user' || msg.role === 'assistant')) {
        valid.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content.trim().substring(0, 3000) }]
        });
      }
    }

    if (valid.length === 0) return [];

    // Primeira = user
    while (valid.length > 0 && valid[0].role !== 'user') valid.shift();

    // Alterna user/model
    var alt = [];
    for (var j = 0; j < valid.length; j++) {
      if (alt.length === 0 || valid[j].role !== alt[alt.length - 1].role) {
        alt.push(valid[j]);
      } else {
        alt[alt.length - 1].parts[0].text += '\n' + valid[j].parts[0].text;
      }
    }

    // Ultima = user
    while (alt.length > 0 && alt[alt.length - 1].role !== 'user') alt.pop();

    return alt;
  }

  // =============================================
  // LIMPA MENSAGENS PARA OPENAI (ChatGPT)
  // =============================================
  function cleanMessagesOpenAI(messages) {
    if (!messages || !Array.isArray(messages)) return [];

    var recent = messages.slice(-12);
    var valid = [];

    for (var i = 0; i < recent.length; i++) {
      var msg = recent[i];
      if (msg && typeof msg.content === 'string' && msg.content.trim() &&
          (msg.role === 'user' || msg.role === 'assistant')) {
        valid.push({
          role: msg.role,
          content: msg.content.trim().substring(0, 3000)
        });
      }
    }

    if (valid.length === 0) return [];

    // Primeira = user
    while (valid.length > 0 && valid[0].role !== 'user') valid.shift();

    // Ultima = user
    while (valid.length > 0 && valid[valid.length - 1].role !== 'user') valid.pop();

    return valid;
  }

  // =============================================
  // CHAMADA GEMINI
  // =============================================
  async function callGemini(model, systemInstruction, contents) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/'
      + model + ':generateContent?key=' + geminiKey;

    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 25000);

    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
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

      if (response.status === 429) {
        setModelCooldown(model, 60);
        return { ok: false, type: 'rateLimit', model: model };
      }
      if (response.status === 400) return { ok: false, type: 'format' };
      if (response.status === 403) return { ok: false, type: 'auth' };
      if (response.status >= 500) {
        setModelCooldown(model, 30);
        return { ok: false, type: 'serverError' };
      }
      if (!response.ok) return { ok: false, type: 'generic' };

      var data = await response.json();

      if (data.promptFeedback && data.promptFeedback.blockReason) {
        return { ok: false, type: 'blocked' };
      }
      if (!data.candidates || data.candidates.length === 0) {
        return { ok: false, type: 'empty' };
      }

      var candidate = data.candidates[0];
      if (candidate.finishReason === 'SAFETY') return { ok: false, type: 'safety' };
      if (candidate.finishReason === 'RECITATION') return { ok: false, type: 'blocked' };

      if (candidate.content && candidate.content.parts) {
        var reply = candidate.content.parts
          .map(function (p) { return p.text || ''; })
          .join('\n').trim();
        if (reply.length > 0) return { ok: true, reply: reply, model: model };
      }

      return { ok: false, type: 'empty' };

    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') return { ok: false, type: 'timeout' };
      return { ok: false, type: 'network' };
    }
  }

  // =============================================
  // CHAMADA OPENAI (ChatGPT)
  // =============================================
  async function callOpenAI(systemInstruction, openaiMessages) {
    if (!openaiKey) return { ok: false, type: 'noKey' };
    if (isModelOnCooldown('openai')) return { ok: false, type: 'cooldown' };

    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 30000);

    try {
      var body = {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemInstruction }
        ].concat(openaiMessages),
        max_tokens: 2048,
        temperature: 0.7,
        top_p: 0.9
      };

      var response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + openaiKey
        },
        signal: controller.signal,
        body: JSON.stringify(body)
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        setModelCooldown('openai', 60);
        return { ok: false, type: 'rateLimit' };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, type: 'auth' };
      }
      if (response.status >= 500) {
        setModelCooldown('openai', 30);
        return { ok: false, type: 'serverError' };
      }
      if (!response.ok) return { ok: false, type: 'generic' };

      var data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        return { ok: false, type: 'empty' };
      }

      var reply = (data.choices[0].message && data.choices[0].message.content || '').trim();
      if (reply.length > 0) {
        return { ok: true, reply: reply, model: OPENAI_MODEL };
      }

      return { ok: false, type: 'empty' };

    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') return { ok: false, type: 'timeout' };
      return { ok: false, type: 'network' };
    }
  }

  // =============================================
  // CADEIA COMPLETA DE FALLBACK
  // Gemini (3 modelos gratis) → ChatGPT (pago)
  // Troca silenciosa, sem erro visivel
  // =============================================
  async function callWithFallback(systemInstruction, geminiContents, openaiMessages) {
    var geminiAvailable = !!geminiKey;
    var openaiAvailable = !!openaiKey;

    // --- FASE 1: Tentar todos os modelos Gemini ---
    if (geminiAvailable) {
      for (var i = 0; i < GEMINI_MODELS.length; i++) {
        var model = GEMINI_MODELS[i];

        if (isModelOnCooldown(model)) {
          console.log('[FF] Pulando ' + model + ' (cooldown)');
          continue;
        }

        console.log('[FF] Tentando ' + model);
        var result = await callGemini(model, systemInstruction, geminiContents);

        if (result.ok) {
          console.log('[FF] Sucesso: ' + model);
          return result;
        }

        console.warn('[FF] ' + model + ' falhou: ' + result.type);

        // Erros de conteudo — nao adianta trocar modelo
        if (['safety', 'blocked'].indexOf(result.type) !== -1) {
          return result;
        }

        // Erro de formato — tenta OpenAI direto (formato diferente)
        if (result.type === 'format') break;

        // Erro de auth Gemini — pula pra OpenAI
        if (result.type === 'auth') break;

        if (i < GEMINI_MODELS.length - 1) await wait(1000);
      }
    }

    // --- FASE 2: ChatGPT como fallback silencioso ---
    if (openaiAvailable) {
      console.log('[FF] Gemini indisponivel, tentando ChatGPT (' + OPENAI_MODEL + ')');
      var openaiResult = await callOpenAI(systemInstruction, openaiMessages);

      if (openaiResult.ok) {
        console.log('[FF] Sucesso: ChatGPT ' + OPENAI_MODEL);
        return openaiResult;
      }

      console.warn('[FF] ChatGPT falhou: ' + openaiResult.type);
    }

    // --- FASE 3: Ultima tentativa Gemini (flash-lite apos espera) ---
    if (geminiAvailable && !isModelOnCooldown('gemini-2.0-flash-lite')) {
      console.log('[FF] Ultima tentativa: flash-lite apos 5s');
      await wait(5000);
      var last = await callGemini('gemini-2.0-flash-lite', systemInstruction, geminiContents);
      if (last.ok) return last;
    }

    return { ok: false, type: 'allFailed' };
  }

  // =============================================
  // HANDLER PRINCIPAL
  // =============================================
  try {
    var body = req.body || {};
    var messages = body.messages;
    var context = body.context;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages' });
    }

    // Prepara mensagens nos 2 formatos (Gemini + OpenAI)
    var geminiContents = cleanMessagesGemini(messages);
    var openaiMessages = cleanMessagesOpenAI(messages);

    if (geminiContents.length === 0 && openaiMessages.length === 0) {
      return res.status(200).json({
        reply: '💬 Nao recebi sua mensagem. Tente: "Analise meus gastos" ou "Como economizar?"'
      });
    }

    // ----- CACHE -----
    var lastUserMsg = '';
    if (geminiContents.length > 0) {
      lastUserMsg = geminiContents[geminiContents.length - 1].parts[0].text;
    } else if (openaiMessages.length > 0) {
      lastUserMsg = openaiMessages[openaiMessages.length - 1].content;
    }

    var cacheKey = getCacheKey(lastUserMsg);
    var cached = getCachedResponse(cacheKey);
    if (cached) {
      console.log('[FF] Cache hit');
      return res.status(200).json({ reply: cached });
    }

    // ----- CHAMA IA COM FALLBACK COMPLETO -----
    var systemInstruction = buildSystemInstruction(context);
    var result = await callWithFallback(systemInstruction, geminiContents, openaiMessages);

    if (result.ok) {
      setCachedResponse(cacheKey, result.reply);
      return res.status(200).json({ reply: result.reply });
    }

    // Safety/blocked = mensagem especifica (nao e erro, e filtro)
    if (result.type === 'safety') {
      return res.status(200).json({
        reply: '🔒 Nao posso responder sobre isso. Sou especializado em financas! Pergunte sobre gastos, economia ou planejamento.'
      });
    }
    if (result.type === 'blocked') {
      return res.status(200).json({
        reply: '🚫 Pergunta bloqueada. Tente reformular! Posso ajudar com gastos, economia ou metas.'
      });
    }

    // Tudo falhou = RESPOSTA OFFLINE INTELIGENTE (sem erro visivel)
    var offlineReply = getOfflineResponse(lastUserMsg, context);
    return res.status(200).json({ reply: offlineReply });

  } catch (err) {
    console.error('[FF] Erro critico:', err.message || err);
    try {
      var msgs = (req.body && req.body.messages) || [];
      var last = msgs.length > 0 ? msgs[msgs.length - 1].content : '';
      return res.status(200).json({ reply: getOfflineResponse(last, '') });
    } catch (e) {
      return res.status(200).json({ reply: '⚠️ Erro tecnico. Tente novamente!' });
    }
  }
};
