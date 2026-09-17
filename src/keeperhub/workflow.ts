import { USDC } from "../config.js";
import { jsonAbi } from "../polymarket/contracts.js";

export interface WorkflowNode {
  id: string;
  type: "trigger" | "action";
  position: { x: number; y: number };
  data: {
    label: string;
    description?: string;
    type: "trigger" | "action";
    config: Record<string, unknown>;
    status: string;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowEnvelope {
  name: string;
  description: string;
  nodeIds: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type RedemptionKind = "classic" | "negRisk";
export type TriggerKind = "Manual" | "Schedule";

export interface RedemptionStep {
  to: string;
  abi: string;
  functionName: string;
  args: unknown[];
}

export interface RedemptionWorkflowOptions {
  name?: string;
  description?: string;
  chainNetwork: string;
  conditionId: string;
  parentCollectionId: string;
  redemption: RedemptionStep;
  redemptionKind: RedemptionKind;
  /** treasury recipient for the USDC payout */
  treasuryAddress: string;
  /** USDC amount in UI units (decimals applied by KeeperHub) */
  usdcAmount: string;
  /** optional pre-step: setApprovalForAll on the CTF for neg-risk redemption */
  approvalStep?: RedemptionStep | null;
  trigger?: TriggerKind;
  scheduleCron?: string;
  /** include resolution gate (read payoutDenominator + condition) */
  gate?: boolean;
}

let posX = 100;
let posY = 260;
function nextPos(): { x: number; y: number } {
  posX += 260;
  return { x: posX, y: posY };
}

function manualTrigger(): WorkflowNode {
  return {
    id: "trigger-resolution",
    type: "trigger",
    position: nextPos(),
    data: {
      label: "Resolution Check",
      type: "trigger",
      config: { triggerType: "Manual" },
      status: "idle",
    },
  };
}

function scheduledTrigger(cron: string): WorkflowNode {
  return {
    id: "trigger-resolution",
    type: "trigger",
    position: nextPos(),
    data: {
      label: "Poll Resolution",
      type: "trigger",
      config: { triggerType: "Schedule", scheduleCron: cron },
      status: "idle",
    },
  };
}

function readResolution(chainNetwork: string, conditionId: string): WorkflowNode {
  return {
    id: "check-resolution",
    type: "action",
    position: nextPos(),
    data: {
      label: "Read Payout Denominator",
      description: "Verify the market has resolved on-chain",
      type: "action",
      config: {
        actionType: "web3/read-contract",
        network: chainNetwork,
        contractAddress: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
        abi: jsonAbi([
          "function payoutDenominator(bytes32 conditionId) external view returns (uint256)",
        ]),
        abiFunction: "payoutDenominator",
        functionArgs: [conditionId],
      },
      status: "idle",
    },
  };
}

function gate(intro: string): WorkflowNode {
  return {
    id: "gate-resolved",
    type: "action",
    position: nextPos(),
    data: {
      label: "Resolved?",
      description: "Gate: continue only after the market resolves",
      type: "action",
      config: {
        actionType: "Condition",
        condition: `${intro} > 0`,
      },
      status: "idle",
    },
  };
}

function redeemNode(step: RedemptionStep, chainNetwork: string): WorkflowNode {
  return {
    id: "redeem",
    type: "action",
    position: nextPos(),
    data: {
      label: "Redeem Winning Shares",
      description: "Burn winning CTF positions and collect USDC",
      type: "action",
      config: {
        actionType: "web3/write-contract",
        network: chainNetwork,
        contractAddress: step.to,
        abi: step.abi,
        abiFunction: step.functionName,
        functionArgs: step.args,
      },
      status: "idle",
    },
  };
}

function distributeNode(
  chainNetwork: string,
  treasuryAddress: string,
  usdcAmount: string
): WorkflowNode {
  return {
    id: "distribute",
    type: "action",
    position: nextPos(),
    data: {
      label: "Route USDC to Treasury",
      description: "Send the guaranteed payout to the precommitted destination",
      type: "action",
      config: {
        actionType: "web3/transfer-token",
        network: chainNetwork,
        tokenConfig: JSON.stringify({ customToken: { address: USDC } }),
        recipientAddress: treasuryAddress,
        amount: usdcAmount,
      },
      status: "idle",
    },
  };
}

export type WorkflowExecKind = "contract-call" | "transfer-token";

/** A normalized, executable workflow step extracted from the staged workflow. */
export interface WorkflowExecStep {
  nodeId: string;
  kind: WorkflowExecKind;
  label: string;
  network: string;
  contractAddress?: string;
  functionName?: string;
  functionArgs?: unknown[];
  abi?: string;
  tokenAddress?: string;
  recipient?: string;
  amountUi?: string;
}

/**
 * The executable nodes of a staged workflow, in order. The workflow envelope
 * contains trigger/read/gate nodes for review; only the write nodes
 * (`web3/write-contract`, `web3/transfer-token`) actually move state. The
 * execute path runs ALL of them, so a redemption is never closed without the
 * distribution that discharges the obligation.
 */
export function executableSteps(workflow: WorkflowEnvelope | undefined): WorkflowExecStep[] {
  if (!workflow) return [];
  const steps: WorkflowExecStep[] = [];
  for (const node of workflow.nodes) {
    const cfg = node.data.config as Record<string, unknown>;
    const actionType = cfg.actionType;
    if (actionType === "web3/write-contract") {
      steps.push({
        nodeId: node.id,
        kind: "contract-call",
        label: node.data.label,
        network: String(cfg.network ?? "137"),
        contractAddress: String(cfg.contractAddress ?? ""),
        functionName: String(cfg.abiFunction ?? ""),
        functionArgs: cfg.functionArgs as unknown[] | undefined,
        abi: cfg.abi as string | undefined,
      });
    } else if (actionType === "web3/transfer-token") {
      let tokenAddress = USDC;
      try {
        const parsed = JSON.parse(String(cfg.tokenConfig ?? "{}")) as {
          customToken?: { address?: string };
          address?: string;
        };
        tokenAddress = parsed.customToken?.address ?? parsed.address ?? USDC;
      } catch {
        tokenAddress = USDC;
      }
      steps.push({
        nodeId: node.id,
        kind: "transfer-token",
        label: node.data.label,
        network: String(cfg.network ?? "137"),
        tokenAddress,
        recipient: String(cfg.recipientAddress ?? ""),
        amountUi: String(cfg.amount ?? "0"),
      });
    }
  }
  return steps;
}

export function buildRedemptionWorkflow(
  opts: RedemptionWorkflowOptions
): WorkflowEnvelope {
  posX = 100;
  posY = 260;

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  let prev = "";

  const trigger =
    opts.trigger === "Schedule"
      ? scheduledTrigger(opts.scheduleCron ?? "*/30 * * * *")
      : manualTrigger();
  nodes.push(trigger);
  prev = trigger.id;

  if (opts.gate !== false) {
    const read = readResolution(opts.chainNetwork, opts.conditionId);
    nodes.push(read);
    edges.push({ id: `e-${prev}-${read.id}`, source: prev, target: read.id });
    prev = read.id;

    const g = gate("{{@check-resolution:Read Payout Denominator.result}}");
    nodes.push(g);
    edges.push({ id: `e-${prev}-${g.id}`, source: prev, target: g.id });
    prev = g.id;
  }

  if (opts.approvalStep) {
    const appr: WorkflowNode = {
      id: "approve-adapter",
      type: "action",
      position: nextPos(),
      data: {
        label: "Approve Redemption Adapter",
        description: "setApprovalForAll so the adapter can burn winning shares",
        type: "action",
        config: {
          actionType: "web3/write-contract",
          network: opts.chainNetwork,
          contractAddress: opts.approvalStep.to,
          abi: opts.approvalStep.abi,
          abiFunction: opts.approvalStep.functionName,
          functionArgs: opts.approvalStep.args,
        },
        status: "idle",
      },
    };
    nodes.push(appr);
    edges.push({ id: `e-${prev}-${appr.id}`, source: prev, target: appr.id });
    prev = appr.id;
  }

  const redeem = redeemNode(opts.redemption, opts.chainNetwork);
  nodes.push(redeem);
  edges.push({ id: `e-${prev}-${redeem.id}`, source: prev, target: redeem.id });
  prev = redeem.id;

  const distribute = distributeNode(
    opts.chainNetwork,
    opts.treasuryAddress,
    opts.usdcAmount
  );
  nodes.push(distribute);
  edges.push({ id: `e-${prev}-${distribute.id}`, source: prev, target: distribute.id });
  prev = distribute.id;

  const envelope: WorkflowEnvelope = {
    name:
      opts.name ??
      `Renn: redeem + route (${opts.redemptionKind}) — ${opts.conditionId.slice(0, 10)}…`,
    description:
      opts.description ??
      "Precommitted execution: when the Polymarket condition resolves, redeem winning CTF shares and route the USDC payout to the treasury. Executed deterministically by KeeperHub.",
    nodeIds: nodes.map((n) => n.id),
    nodes,
    edges,
  };
  return envelope;
}