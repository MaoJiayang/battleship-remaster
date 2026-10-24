import model from '#naval-preview-model';
import { PreviewDecisionHistory, PreviewPolicyRuntime } from './previewPolicyRuntime.js';

export const neuralPreview = true;
export const policyLabel = '神经 AI 体验版 · GRU/PPO 48 · 学说平衡未验收';
export const policyMetadata = { format: model.format, kind: model.memoryKind, iteration: 48,
    sha256: 'bc91d7b32a7257b189d64b26d13dc508e643d63778b62fb6123f71dc859dfa9a' };
const history = new PreviewDecisionHistory();
const runtime = new PreviewPolicyRuntime(model);

export const captureDecisionEvent = (...arguments_) => history.capture(...arguments_);
export const completeDecisionEvent = (...arguments_) => history.complete(...arguments_);
export const decisionHistoryContext = viewGrid => history.context(viewGrid);
export const makeAIDecisionAsync = context => runtime.decide(context);
export function resetAIState() {
    history.reset();
    runtime.reset();
}
