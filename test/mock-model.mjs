// Minimal stand-in for the Anthropic Messages API: answers the three prompts with plausible JSON.
import http from 'node:http';
const port = Number(process.argv[2] || 4020);
http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    const j = JSON.parse(b); const txt = JSON.stringify(j.messages[0].content);
    if (j.stream) {
      res.setHeader('content-type', 'text/event-stream');
      const ctx = (j.system || []).map((x) => x.text).join(' '); const hasCtx = ctx.includes('<field_context>');
      const text = `Short answer for this field (context: ${hasCtx}). Vary the construct first [flake2023-01].\n\n- Check consequentiality [isager2021-02]\n- Fake [fake2020-01]`;
      const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
      ev({ type: 'message_start', message: { model: 'mock' } });
      (async () => { for (const w of text.match(/.{1,10}/gs)) { ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w } }); await new Promise((r) => setTimeout(r, 5)); } ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }); ev({ type: 'message_stop' }); res.end(); })();
      return;
    }
    let out;
    if (txt.includes('PART 1 — CLAIMS')) out = { citation: 'Doe, J., & Roe, R. (2015). Social performance pays. Strategic Management Journal, 36(1), 1–20.', summary: 'Tests whether CSR ratings predict ROA in US firms. Finds a positive association.', data_source: 'KLD and Compustat, US listed firms 1995–2010',
      claims: [{ key: 'c1', text: 'Corporate social performance is positively associated with financial performance.', main: true, effect: 'b = 0.12, p < .01', quote: 'social performance is positively related to subsequent financial performance', page: 2,
        assumptions: [
          { key: 'c1-a1', dimension: 'theory', text: 'The effect runs through stakeholder trust rather than reverse causality.', consequential: 3, varied: 'no', how: null, quote: 'we argue that stakeholder trust drives the relationship', page: 4 },
          { key: 'c1-a2', dimension: 'constructs', text: 'KLD ratings capture social performance.', consequential: 3, varied: 'no', how: null, quote: 'we measure social performance using KLD ratings', page: 7 },
          { key: 'c1-a3', dimension: 'design', text: 'US listed firms in Compustat represent the population of interest.', consequential: 2, varied: 'no', how: null, quote: 'our sample comprises US listed firms covered by Compustat', page: 8 },
          { key: 'c1-a4', dimension: 'analysis', text: 'The OLS specification with industry controls identifies the association.', consequential: 2, varied: 'partly', how: 'robustness with firm fixed effects', quote: 'results are robust to the inclusion of firm fixed effects', page: 12 },
          { key: 'c1-a5', dimension: 'context', text: 'The relationship holds in the 1995–2010 US context.', consequential: 2, varied: 'no', how: null, quote: 'the sample period runs from 1995 to 2010', page: 8 }] }],
      choices: [
        { key: 'ch1', category: 'sample', description: 'Exclude financial firms (SIC 6000–6999)', options: ['exclude', 'include'], alternatives_reported: false, quote: 'we exclude financial firms', page: 8 },
        { key: 'ch2', category: 'controls', description: 'Control for firm size as log of total assets', options: ['log assets', 'log sales'], alternatives_reported: true, quote: 'firm size is measured as the log of total assets', page: 9 },
        { key: 'ch3', category: 'model', description: 'Industry-year fixed effects vs firm fixed effects', options: ['industry-year FE', 'firm FE'], alternatives_reported: true, quote: 'results are robust to the inclusion of firm fixed effects', page: 12 }] };
    else if (txt.includes('ASSUMPTIONS:')) { const ids = [...txt.matchAll(/- id (a_\w+)/g)].map((m) => m[1]); out = { citation: 'Smith, S. (2020). Replicating CSR effects in Europe. Journal of Management, 46(2), 100–130.', tags: ids.map((id, i) => ({ assumption: id, varied: i === 0 ? 'no' : i % 2 ? 'yes' : 'partly', how: i === 0 ? null : 'European sample and alternative rating provider', result: i === 0 ? 'na' : 'supports', quote: i === 0 ? null : 'we re-estimate the model on European firms using Asset4 ratings', page: 5 })) }; }
    else if (txt.includes('LIST R:')) { const r = [...txt.matchAll(/R (r\d+):/g)].map((m) => m[1]); const a = [...txt.matchAll(/A ([^:\s]+):/g)].map((m) => m[1]); out = { matches: r.map((k, i) => ({ r: k, a: a[i] ? [a[i]] : [], confidence: 'high', note: a[i] ? 'same decision' : 'not found' })), added: a.slice(r.length) }; }
    else out = null;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'mock', usage: { input_tokens: 10, output_tokens: 10 }, stop_reason: 'end_turn', content: [{ type: 'text', text: out ? '```json\n' + JSON.stringify(out) + '\n```' : 'Plain answer citing [forrt2025-01] and [fake2020-01].' }] }));
  });
}).listen(port, () => console.log('mock model on', port));
