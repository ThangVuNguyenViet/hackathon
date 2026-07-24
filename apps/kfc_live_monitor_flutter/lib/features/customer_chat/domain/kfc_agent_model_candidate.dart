enum KfcAgentModelCandidate {
  openAi(
    wireName: 'openai-gpt-4.1-mini',
    displayName: 'GPT-4.1 mini',
    providerName: 'OpenAI',
  ),
  deepSeek(
    wireName: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    providerName: 'OpenCode',
  ),
  qwen(
    wireName: 'qwen3.7-max',
    displayName: 'Qwen 3.7 Max',
    providerName: 'OpenCode',
  ),
  miniMax(
    wireName: 'minimax-m3',
    displayName: 'MiniMax M3',
    providerName: 'OpenCode',
  );

  const KfcAgentModelCandidate({
    required this.wireName,
    required this.displayName,
    required this.providerName,
  });

  final String wireName;
  final String displayName;
  final String providerName;
}
