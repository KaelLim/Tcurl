/**
 * TCurl Web Components
 * 統一匯入所有元件
 *
 * @example
 * // 在 HTML 中使用
 * <script type="module" src="/js/components/index.js"></script>
 *
 * // 或在 JS 中
 * import '/js/components/index.js';
 */

// Base
export { TCElement, CSS_VARS, CSS_RESET, MATERIAL_SYMBOLS } from './base.js';

// Basic Components
export { TCButton } from './tc-button.js';
export { TCInput } from './tc-input.js';
export { TCTextarea } from './tc-textarea.js';
export { TCSelect } from './tc-select.js';
export { TCBadge } from './tc-badge.js';
export { TCAvatar } from './tc-avatar.js';
export { TCToggle } from './tc-toggle.js';

// Layout Components
export { TCCard } from './tc-card.js';
export { TCSidebar } from './tc-sidebar.js';
export { TCPageHeader } from './tc-page-header.js';
export { TCTable, TCThead, TCTbody, TCTr, TCTh, TCTd } from './tc-table.js';
export { TCStatCard } from './tc-stat-card.js';
export { TCEmptyState } from './tc-empty-state.js';

// Interactive Components
export { TCModal } from './tc-modal.js';
export { TCToast } from './tc-toast.js';
export { TCLoading } from './tc-loading.js';
export { TCDropdown, TCDropdownItem, TCDropdownDivider } from './tc-dropdown.js';
export { TCTooltip } from './tc-tooltip.js';

// Navigation Components
export { TCTabs, TCTab, TCTabPanel } from './tc-tabs.js';
export { TCPagination } from './tc-pagination.js';
export { TCBreadcrumb, TCBreadcrumbItem } from './tc-breadcrumb.js';

// Data Visualization
export { TCChart } from './tc-chart.js';

// Feedback Components
export { TCSkeleton } from './tc-skeleton.js';

// Make TCToast globally available
import { TCToast } from './tc-toast.js';
window.TCToast = TCToast;

console.log('TCurl Web Components loaded (v2.0)');
