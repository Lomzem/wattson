import {
	nodeRelationship,
	powerNodes,
	regulatorInputs,
	type PowerModel,
	type PowerNode
} from './power-document';

export interface TopologyInput {
	port: string;
	name: string;
	node?: PowerNode;
}

export interface ConversionPath {
	regulator: PowerNode;
	inputs: TopologyInput[];
	outputName: string;
	output?: PowerNode;
	loads: PowerNode[];
}

export interface DirectPath {
	rail: PowerNode;
	loads: PowerNode[];
}

export interface Topology {
	conversions: ConversionPath[];
	direct: DirectPath[];
	unlinked: PowerNode[];
}

export function buildTopology(model: PowerModel): Topology {
	const rails = powerNodes(model, 'source', 'rail');
	const railsByName = new Map(rails.map((node) => [node.name, node]));
	const loadsByRail = new Map<string, PowerNode[]>();
	for (const load of model.loads) {
		const rail = nodeRelationship(load, 'rail');
		loadsByRail.set(rail, [...(loadsByRail.get(rail) ?? []), load]);
	}
	const conversions = model.regulators.map((regulator) => {
		const inputs = regulatorInputs(regulator).map(({ port, name }) => ({
			port,
			name,
			node: railsByName.get(name)
		}));
		const outputName = nodeRelationship(regulator, 'output');
		return {
			regulator,
			inputs,
			outputName,
			output: railsByName.get(outputName),
			loads: loadsByRail.get(outputName) ?? []
		};
	});
	const outputNames = new Set(conversions.map(({ outputName }) => outputName));
	const direct = rails
		.map((rail) => ({ rail, loads: loadsByRail.get(rail.name) ?? [] }))
		.filter((branch) => branch.loads.length && !outputNames.has(branch.rail.name));
	const usedRailNames = new Set([
		...conversions.flatMap(({ inputs }) => inputs.map(({ name }) => name)),
		...conversions.map(({ outputName }) => outputName),
		...direct.map(({ rail }) => rail.name)
	]);
	const representedLoads = new Set([
		...conversions.flatMap(({ loads }) => loads),
		...direct.flatMap(({ loads }) => loads)
	]);
	return {
		conversions,
		direct,
		unlinked: [
			...rails.filter((rail) => !usedRailNames.has(rail.name)),
			...model.loads.filter((load) => !representedLoads.has(load))
		]
	};
}
