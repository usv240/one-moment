// Every source the site cites. Every claim on the site links to one of these.
// If a claim has no entry here, it is ours, and it is labelled as measured by us.

export type Citation = { id: string; short: string; full: string; href: string; group: Group };
export type Group = 'Turn-taking' | 'Aphasia and partner training' | 'Speech recognition and AI' | 'Relay services and regulation' | 'Design and accessibility';

export const CITATIONS: Citation[] = [
  { id: 'stivers', group: 'Turn-taking', short: 'Stivers et al. 2009', full: 'Stivers, T. et al. (2009). Universals and cultural variation in turn-taking in conversation. PNAS 106(26), 10587-10592.', href: 'https://www.pnas.org/doi/10.1073/pnas.0903616106' },
  { id: 'kagan', group: 'Aphasia and partner training', short: 'Kagan et al. 2001', full: 'Kagan, A. et al. (2001). Training volunteers as conversation partners using Supported Conversation for Adults with Aphasia (SCA): a controlled trial. JSLHR 44(3).', href: 'https://pubs.asha.org/doi/10.1044/1092-4388(2001/051)' },
  { id: 'smackie2010', group: 'Aphasia and partner training', short: 'Simmons-Mackie et al. 2010', full: 'Simmons-Mackie, N. et al. (2010). Communication partner training in aphasia: a systematic review. Archives of Physical Medicine and Rehabilitation.', href: 'https://www.archives-pmr.org/article/S0003-9993(10)00771-9/abstract' },
  { id: 'smackie2016', group: 'Aphasia and partner training', short: 'Simmons-Mackie et al. 2016', full: 'Simmons-Mackie, N., Raymer, A., Cherney, L. (2016). Communication partner training in aphasia: an updated systematic review. Archives of Physical Medicine and Rehabilitation.', href: 'https://www.archives-pmr.org/article/S0003-9993(16)30074-0/abstract' },
  { id: 'asha', group: 'Aphasia and partner training', short: 'ASHA Practice Portal', full: 'American Speech-Language-Hearing Association. Practice Portal: Aphasia.', href: 'https://www.asha.org/practice-portal/clinical-topics/aphasia/' },
  { id: 'nidcd', group: 'Aphasia and partner training', short: 'NIDCD', full: 'NIDCD. Quick statistics about voice, speech, language.', href: 'https://www.nidcd.nih.gov/health/statistics/quick-statistics-voice-speech-language' },
  { id: 'frontiers2024', group: 'Speech recognition and AI', short: 'Frontiers in Public Health 2024', full: 'AI-assisted assessment and treatment of aphasia: a review (2024). Frontiers in Public Health.', href: 'https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2024.1401240/full' },
  { id: 'mao2025', group: 'Speech recognition and AI', short: 'Mao et al. 2025', full: 'Mao, L., Lee, J.H., Faroqi-Shah, Y., Valencia, S. (2025). Design probes for AI-driven AAC. arXiv:2504.09435.', href: 'https://arxiv.org/abs/2504.09435' },
  { id: 'debate', group: 'Speech recognition and AI', short: 'Irving et al. 2018', full: 'Irving, G., Christiano, P., Amodei, D. (2018). AI safety via debate. arXiv:1805.00899.', href: 'https://arxiv.org/abs/1805.00899' },
  { id: 'du2023', group: 'Speech recognition and AI', short: 'Du et al. 2023', full: 'Du, Y. et al. (2023). Improving factuality and reasoning in language models through multiagent debate. arXiv:2305.14325.', href: 'https://arxiv.org/abs/2305.14325' },
  { id: 'torgo', group: 'Speech recognition and AI', short: 'TORGO', full: 'Rudzicz, F., Namasivayam, A.K., Wolff, T. (2012). The TORGO database of acoustic and articulatory speech from speakers with dysarthria. Language Resources and Evaluation.', href: 'https://www.cs.toronto.edu/~complingweb/data/TORGO/torgo.html' },
  { id: 'harvard', group: 'Speech recognition and AI', short: 'Harvard Sentences', full: 'IEEE Recommended Practice for Speech Quality Measurements, IEEE Std 297-1969, Appendix C. Public domain.', href: 'https://doi.org/10.1109/IEEESTD.1969.7405210' },
  { id: 'aai-streaming', group: 'Speech recognition and AI', short: 'AssemblyAI Streaming API', full: 'AssemblyAI. Universal-Streaming API reference.', href: 'https://www.assemblyai.com/docs/api-reference/streaming-api/streaming-api' },
  { id: 'aai-agent', group: 'Speech recognition and AI', short: 'AssemblyAI Voice Agent API', full: 'AssemblyAI. Voice Agent API: connect your own LLM.', href: 'https://www.assemblyai.com/docs/voice-agents/voice-agent-api/connect-your-own-llm' },
  { id: 'fcc-sts', group: 'Relay services and regulation', short: 'FCC, Speech to Speech Relay', full: 'Federal Communications Commission. Speech to Speech Relay Service consumer guide.', href: 'https://www.fcc.gov/consumers/guides/speech-speech-relay-service' },
  { id: 'fcc-rates', group: 'Relay services and regulation', short: 'FCC DA 25-571', full: 'FCC DA 25-571 (1 July 2025). TRS Fund compensation rates, Fund Year 2025-26.', href: 'https://docs.fcc.gov/public/attachments/DA-25-571A1.txt' },
  { id: 'fedreg2026', group: 'Relay services and regulation', short: 'Federal Register, 2 Jan 2026', full: 'Federal Register (2 January 2026). Analog Telecommunications Relay Service Modernization.', href: 'https://www.federalregister.gov/documents/2026/01/02/2025-24210/analog-telecommunications-relay-service-modernization' },
  { id: 'sca', group: 'Design and accessibility', short: 'Aphasia Institute, SCA', full: 'Aphasia Institute. Supported Conversation for Adults with Aphasia: communicative access tools.', href: 'https://www.aphasia.ca/communication-tools-communicative-access-sca/' },
  { id: 'rose', group: 'Design and accessibility', short: 'Rose et al. 2003, 2011', full: 'Rose, T., Worrall, L., McKenna, K. (2003), and Rose et al. (2011). Aphasia friendly written health information: content and design characteristics.', href: 'https://pubmed.ncbi.nlm.nih.gov/?term=Aphasia+friendly+written+health+information+content+and+design+characteristics' },
  { id: 'wcag', group: 'Design and accessibility', short: 'WCAG 2.2', full: 'W3C. Web Content Accessibility Guidelines 2.2.', href: 'https://www.w3.org/TR/WCAG22/' },
];

export const cite = (id: string): Citation => {
  const c = CITATIONS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown citation ${id}`);
  return c;
};
