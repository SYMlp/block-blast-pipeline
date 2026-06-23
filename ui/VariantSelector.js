// VariantSelector — renders the variant buttons + a live parameter diff table
// (current variant vs control). Purely presentational; calls onSelect(id).

const VARIANT_ORDER = ['control', 'compact', 'relaxed', 'hard-mode', 'ai-brisk'];
const VARIANT_NAMES = { control: '对照组', compact: '紧凑版', relaxed: '宽松版', 'hard-mode': '高难版', 'ai-brisk': '明快·AI生成' };

// Field paths shown in the diff table, in display order.
const DIFF_FIELDS = [
  ['board.width', '棋盘宽'],
  ['board.height', '棋盘高'],
  ['spawn.density', '生成密度'],
  ['spawn.shape_set', '片库'],
  ['spawn.big_piece_weight_mult', '大片权重'],
  ['scoring.clear_base_factor', '计分系数'],
  ['scoring.combo_curve', '连击曲线'],
  ['difficulty.dda_enabled', 'DDA'],
  ['juice.line_clear_trauma', '震屏'],
  ['juice.hit_stop_ms', '冻帧ms'],
  ['juice.particles_per_cell', '粒子/格'],
];

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export class VariantSelector {
  constructor(barEl, diffEl, onSelect) {
    this.barEl = barEl;
    this.diffEl = diffEl;
    this.onSelect = onSelect;
    this.controlConfig = null;
    this.renderButtons();
  }

  renderButtons() {
    this.barEl.innerHTML = '';
    for (const id of VARIANT_ORDER) {
      const b = document.createElement('button');
      b.className = 'vbtn';
      b.dataset.id = id;
      b.textContent = VARIANT_NAMES[id];
      b.onclick = () => this.onSelect(id);
      this.barEl.appendChild(b);
    }
  }

  setControl(config) { this.controlConfig = config; }

  // Highlight the active button and render the diff vs control.
  update(activeId, config) {
    this.barEl.querySelectorAll('.vbtn').forEach((b) => b.classList.toggle('on', b.dataset.id === activeId));
    if (!this.controlConfig || activeId === 'control') {
      this.diffEl.textContent = activeId === 'control' ? '对照组（基线）' : '';
      return;
    }
    const rows = [];
    for (const [path, label] of DIFF_FIELDS) {
      const cur = get(config, path);
      const base = get(this.controlConfig, path);
      if (cur !== base) rows.push(`${label} ${base}→${cur}`);
    }
    this.diffEl.textContent = rows.length ? 'vs对照: ' + rows.join(' · ') : 'vs对照: 无差异';
  }
}

export { VARIANT_ORDER, VARIANT_NAMES };
