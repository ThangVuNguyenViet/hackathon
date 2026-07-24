import {
  isLiveAgentModelCandidateId,
  type ConfiguredAgentModelBinding,
} from '../config/agentModelProfile.js';

export function resolveDemoAgentModelBinding(input: {
  candidateId?: string;
  defaultBinding?: ConfiguredAgentModelBinding;
  candidates?: Readonly<Partial<Record<string, ConfiguredAgentModelBinding>>>;
}):
  | { ok: true; binding: ConfiguredAgentModelBinding }
  | {
      ok: false;
      status: 400 | 503;
      errorCode: 'invalid_agent_candidate' | 'agent_candidate_unavailable';
    } {
  if (input.candidateId === undefined) {
    return input.defaultBinding
      ? { ok: true, binding: input.defaultBinding }
      : {
          ok: false,
          status: 503,
          errorCode: 'agent_candidate_unavailable',
        };
  }
  if (!isLiveAgentModelCandidateId(input.candidateId)) {
    return {
      ok: false,
      status: 400,
      errorCode: 'invalid_agent_candidate',
    };
  }
  const binding = input.candidates?.[input.candidateId];
  return binding
    ? { ok: true, binding }
    : {
        ok: false,
        status: 503,
        errorCode: 'agent_candidate_unavailable',
      };
}
