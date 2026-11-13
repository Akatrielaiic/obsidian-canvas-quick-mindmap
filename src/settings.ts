import { App, Plugin, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import { t } from "./i18n";

/**
 * A collapsed branch: the nodes it hides, and where one of them (the anchor) sits from the collapsed
 * node, so the hidden nodes can follow it when it moves.
 */
export interface Fold { ids: string[]; anchor: string; dx: number; dy: number }

export interface Settings {
	autoLayout: boolean;
	enterInEdit: boolean;
	tabAddsChild: boolean;
	mobileKeys: boolean;
	arrowKeys: boolean;
	linkArrows: boolean;
	routeLinks: boolean;
	compact: boolean;
	balanceFrom: number;
	hGap: number;
	vGap: number;
	inheritColor: boolean;
	renamePasted: boolean;
	autoSize: boolean;
	maxWidth: number;
	/** Collapsed branches, by canvas path, then by the collapsed node's id. Not shown in the settings tab. */
	folds: Record<string, Record<string, Fold>>;
}

export const DEFAULT_SETTINGS: Settings = {
	autoLayout: true,
	enterInEdit: true,
	tabAddsChild: false,
	mobileKeys: false,
	arrowKeys: true,
	linkArrows: true,
	routeLinks: true,
	compact: true,
	balanceFrom: 5,
	hGap: 160,
	vGap: 20,
	inheritColor: true,
	renamePasted: true,
	autoSize: true,
	maxWidth: 320,
	folds: {},
};

type ToggleKey = "autoLayout" | "enterInEdit" | "tabAddsChild" | "mobileKeys" | "arrowKeys" | "linkArrows" | "routeLinks" | "compact" | "inheritColor" | "autoSize" | "renamePasted";
type SliderKey = "hGap" | "vGap" | "maxWidth" | "balanceFrom";
type SettingSpec =
	| { kind: "toggle"; key: ToggleKey; name: string; desc: string }
	| { kind: "slider"; key: SliderKey; name: string; desc: string; min: number; max: number; step: number };

function settingSpecs(): SettingSpec[] {
	const s = t();
	return [
		{ kind: "toggle", key: "autoLayout", name: s.autoLayout, desc: s.autoLayoutDesc },
		{ kind: "toggle", key: "enterInEdit", name: s.enterInEdit, desc: s.enterInEditDesc },
		{ kind: "toggle", key: "tabAddsChild", name: s.tabAddsChild, desc: s.tabAddsChildDesc },
		{ kind: "toggle", key: "mobileKeys", name: s.mobileKeys, desc: s.mobileKeysDesc },
		{ kind: "toggle", key: "arrowKeys", name: s.arrowKeys, desc: s.arrowKeysDesc },
		{ kind: "slider", key: "hGap", name: s.hGap, desc: s.hGapDesc, min: 80, max: 400, step: 10 },
		{ kind: "slider", key: "vGap", name: s.vGap, desc: s.vGapDesc, min: 0, max: 200, step: 10 },
		{ kind: "toggle", key: "compact", name: s.compact, desc: s.compactDesc },
		{ kind: "slider", key: "balanceFrom", name: s.balanceFrom, desc: s.balanceFromDesc, min: 0, max: 12, step: 1 },
		{ kind: "toggle", key: "linkArrows", name: s.linkArrows, desc: s.linkArrowsDesc },
		{ kind: "toggle", key: "routeLinks", name: s.routeLinks, desc: s.routeLinksDesc },
		{ kind: "toggle", key: "inheritColor", name: s.inheritColor, desc: s.inheritColorDesc },
		{ kind: "toggle", key: "autoSize", name: s.autoSize, desc: s.autoSizeDesc },
		{ kind: "slider", key: "maxWidth", name: s.maxWidth, desc: s.maxWidthDesc, min: 160, max: 800, step: 20 },
		{ kind: "toggle", key: "renamePasted", name: s.renamePasted, desc: s.renamePastedDesc },
	];
}

export interface SettingsHost extends Plugin {
	settings: Settings;
	saveSettings(): Promise<void>;
}

export class SettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SettingsHost) {
		super(app, plugin);
	}

	/** 1.13+: declarative settings, searchable from the settings window. Values go through plugin.settings. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return settingSpecs().map((spec) =>
			spec.kind === "toggle"
				? { name: spec.name, desc: spec.desc, control: { type: "toggle", key: spec.key, defaultValue: DEFAULT_SETTINGS[spec.key] } }
				: {
						name: spec.name,
						desc: spec.desc,
						control: { type: "slider", key: spec.key, min: spec.min, max: spec.max, step: spec.step, defaultValue: DEFAULT_SETTINGS[spec.key] },
					},
		);
	}

	/** Before 1.13 (minAppVersion is 1.8.7). */
	display() {
		const { containerEl } = this;
		containerEl.empty();
		for (const spec of settingSpecs()) {
			const row = new Setting(containerEl).setName(spec.name).setDesc(spec.desc);
			if (spec.kind === "toggle") {
				const key = spec.key;
				row.addToggle((tg) =>
					tg.setValue(this.plugin.settings[key]).onChange(async (v) => {
						this.plugin.settings[key] = v;
						await this.plugin.saveSettings();
					}),
				);
			} else {
				const key = spec.key;
				row.addSlider((sl) =>
					sl
						.setLimits(spec.min, spec.max, spec.step)
						.setValue(this.plugin.settings[key])
						.onChange(async (v) => {
							this.plugin.settings[key] = v;
							await this.plugin.saveSettings();
						}),
				);
			}
		}
	}
}
