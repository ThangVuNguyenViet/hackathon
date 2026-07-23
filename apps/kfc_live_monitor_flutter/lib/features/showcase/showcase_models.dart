import '../customer_chat/domain/kfc_genui_models.dart';

enum ShowcaseMode { genui, text }

extension ShowcaseModeValue on ShowcaseMode {
  String get value => name;
  String get label => this == ShowcaseMode.genui ? 'GenUI' : 'Text only';
}

class ShowcaseCatalog {
  const ShowcaseCatalog(this.scenarios);

  factory ShowcaseCatalog.fromJson(Map<String, Object?> json) =>
      ShowcaseCatalog(
        (json['scenarios'] as List<Object?>? ?? const [])
            .cast<Map<String, Object?>>()
            .map(ShowcaseScenario.fromJson)
            .toList(growable: false),
      );

  final List<ShowcaseScenario> scenarios;
}

class ShowcaseScenario {
  const ShowcaseScenario({
    required this.id,
    required this.title,
    required this.goal,
    required this.preconditions,
    required this.useCases,
    required this.risks,
    required this.turns,
    required this.results,
  });

  factory ShowcaseScenario.fromJson(Map<String, Object?> json) {
    final results = json['results'] as Map<String, Object?>? ?? const {};
    return ShowcaseScenario(
      id: json['id']! as String,
      title: json['title']! as String,
      goal: json['goal'] as String? ?? '',
      preconditions: (json['preconditions'] as List<Object?>? ?? const [])
          .cast<String>(),
      useCases: (json['useCases'] as List<Object?>? ?? const []).cast<String>(),
      risks:
          (json['risks'] as List<Object?>? ??
                  json['acceptanceCriteria'] as List<Object?>? ??
                  const [])
              .cast<String>(),
      turns: (json['turns'] as List<Object?>? ?? const [])
          .cast<Map<String, Object?>>()
          .map(ShowcaseTurn.fromJson)
          .toList(growable: false),
      results: {
        for (final mode in ShowcaseMode.values)
          if (results[mode.value] case final Map<String, Object?> value)
            mode: ShowcaseResult.fromJson(value),
      },
    );
  }

  final String id;
  final String title;
  final String goal;
  final List<String> preconditions;
  final List<String> useCases;
  final List<String> risks;
  final List<ShowcaseTurn> turns;
  final Map<ShowcaseMode, ShowcaseResult> results;
}

class ShowcaseTurn {
  const ShowcaseTurn({
    required this.index,
    required this.text,
    required this.useCases,
  });
  factory ShowcaseTurn.fromJson(Map<String, Object?> json) => ShowcaseTurn(
    index: json['index']! as int,
    text: json['text']! as String,
    useCases: (json['useCases'] as List<Object?>? ?? const []).cast<String>(),
  );
  final int index;
  final String text;
  final List<String> useCases;
}

class ShowcaseResult {
  const ShowcaseResult({
    required this.scenarioId,
    required this.mode,
    required this.sessionId,
    required this.generatedAt,
    required this.releaseSha,
    required this.agent,
    required this.langsmithTraceUrl,
    required this.transcript,
  });

  factory ShowcaseResult.fromJson(Map<String, Object?> json) => ShowcaseResult(
    scenarioId: json['scenarioId']! as String,
    mode: ShowcaseMode.values.byName(json['mode']! as String),
    sessionId: json['sessionId']! as String,
    generatedAt: DateTime.parse(json['generatedAt']! as String),
    releaseSha: json['releaseSha']! as String,
    agent: ShowcaseAgentIdentity.fromJson(
      json['agent']! as Map<String, Object?>,
    ),
    langsmithTraceUrl: json['langsmithTraceUrl'] as String?,
    transcript: (json['transcript'] as List<Object?>? ?? const [])
        .cast<Map<String, Object?>>()
        .map(ShowcaseTranscriptEntry.fromJson)
        .toList(growable: false),
  );

  final String scenarioId;
  final ShowcaseMode mode;
  final String sessionId;
  final DateTime generatedAt;
  final String releaseSha;
  final ShowcaseAgentIdentity agent;
  final String? langsmithTraceUrl;
  final List<ShowcaseTranscriptEntry> transcript;
}

class ShowcaseAgentIdentity {
  const ShowcaseAgentIdentity({
    required this.provider,
    required this.model,
    required this.profile,
  });

  factory ShowcaseAgentIdentity.fromJson(Map<String, Object?> json) =>
      ShowcaseAgentIdentity(
        provider: json['provider']! as String,
        model: json['model']! as String,
        profile: json['profile']! as String,
      );

  final String provider;
  final String model;
  final String profile;
}

class ShowcaseTranscriptEntry {
  const ShowcaseTranscriptEntry({
    required this.role,
    required this.text,
    this.genUi,
  });
  factory ShowcaseTranscriptEntry.fromJson(Map<String, Object?> json) {
    final genUi = json['genUi'];
    return ShowcaseTranscriptEntry(
      role: json['role']! as String,
      text: json['text']! as String,
      genUi: genUi is Map<String, Object?>
          ? KfcGenUiAttachment.fromJson(genUi)
          : null,
    );
  }
  final String role;
  final String text;
  final KfcGenUiAttachment? genUi;
}
