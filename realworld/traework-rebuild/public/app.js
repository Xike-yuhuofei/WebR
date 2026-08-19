/**
 * TraeWork replica runtime (authored for the WebR production benchmark).
 *
 * Reconstructed from the frozen evidence package (realworld/traework.webr):
 * the observable DOM structure (tags, ids, roles, aria, text), the three-
 * column layout, the recorded interaction states and the responsive
 * breakpoints. All classes/styles/logic are authored per
 * docs/architecture/05-SOURCE-CONVENTION.md (wr-* / is-* / --wr-*).
 *
 * No original JS/CSS is shipped; no external resource is referenced.
 */
import { icons } from './icons.js';

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

/** Insert aria-hidden="true" into an icon's opening svg tag. */
function ah(iconHtml) {
  return iconHtml.replace('<svg ', '<svg aria-hidden="true" ');
}

// ---------------------------------------------------------------------------
// Entry-route DOM templates (mirror of the captured golden structure)
// ---------------------------------------------------------------------------

/** Sidebar (left column) — desktop tree. */
function sidebarDesktop(opts) {
  const navItems = opts.navItems
    .map(
      (n) => `
      <div class="wr-NavItem${n.active ? ' is-active' : ''}"${n.active ? ' data-tea-event-name="icube_home_tab_click"' : ''}>
        <span class="wr-NavItemIcon">${icons[n.icon]}</span>
        <span class="wr-NavItemText">${n.text}</span>${
          n.hotkey
            ? `<span class="wr-Hotkey">${n.hotkey.map((k) => `<span class="wr-Key">${k}</span>`).join('')}</span>`
            : ''
        }
      </div>`,
    )
    .join('');
  return `
    <aside class="wr-Sidebar">
      <div class="wr-SidebarHeader">
        <div>
          <div>
            <span class="wr-Trigger">
              <button class="wr-IconButton" type="button" title="切换左侧面板">
                <span class="wr-IconBox">${icons.ViewLeft_line}</span>
              </button>
            </span>
          </div>
        </div>
        <span class="wr-Trigger">
          <button class="wr-IconButton" type="button" title="搜索">
            <span class="wr-IconBox">${icons.Search}</span>
          </button>
        </span>
      </div>
      <div class="wr-SidebarHeaderRight"></div>
      <div class="wr-ModeContent">
        <div class="wr-ModeContainer">
          <div class="wr-TabBar" role="tablist" style="--indicator-left: 56px; --indicator-width: 71px">
            <div class="wr-TabIndicator" aria-hidden="true"></div>
            <button class="wr-Tab" role="tab" aria-selected="false" style="width: 50px">
              <span class="wr-TabIcon">${ah(icons.icon2)}</span><span>Work</span>
            </button>
            <button class="wr-Tab is-active" role="tab" aria-selected="true" style="width: 71px">
              <span class="wr-TabIcon is-visible">${ah(icons.icon3)}</span><span>Code</span>
            </button>
            <button class="wr-Tab" role="tab" aria-selected="false" style="width: 62px">
              <span class="wr-TabIcon">${ah(icons.icon4)}</span><span>Design</span>
            </button>
          </div>
        </div>
      </div>
      <div class="wr-PrimarySection">
        ${navItems}
      </div>
      <div class="wr-ProjectsSection">
        <div class="wr-ProjectsSectionInner">
          <div class="wr-ProjectsContent">
            <div class="wr-ProjectsHeader">
              <span class="wr-ProjectsHeading"><span> 任务列表</span></span>
              <div class="wr-ProjectsHeaderActions">
                <span class="wr-TriggerGroup">
                  <span class="wr-Trigger">
                    <button class="wr-IconButton" type="button" title="过滤">
                      <span class="wr-IconBox"><span data-testid="chat-icon-list-filter" style="display: inline-flex; align-items: center; justify-content: center;">${icons.list_filter}</span></span>
                    </button>
                  </span>
                </span>
              </div>
            </div>
            <div class="wr-TaskListCollapsible">
              <div class="wr-TaskListCollapsibleInner">
                <div class="wr-ProjectsEmpty">${icons.NoTask}</div>
                <span class="wr-ProjectsEmptyText">暂无任务</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="wr-FileTreeWrapper"></div>
      <div class="wr-SidebarFooter">
        <div class="wr-SidebarFooterContent">
          <div class="wr-AccountRoot">
            <span class="wr-TriggerGroup">
              <button class="wr-AccountTrigger" type="button">
                <span class="wr-AccountTriggerAvatar"><img src="/assets/files/faf9eaa6ff86f4156dd1414ab7f2544a-128x128-6ba8804e2d.image" alt="稀客" /></span>
                <span class="wr-AccountTriggerName">稀客</span>
                <span class="wr-AccountTriggerMembership"><span class="wr-AccountBrandTag">Pro+</span></span>
              </button>
            </span>
            <button class="wr-AccountAccessoryButton" type="button">
              <span>下载桌面端</span>
              ${icons.download}
            </button>
          </div>
        </div>
      </div>
    </aside>
    <div class="wr-SplitHandle"></div>`;
}

/** Center column — Code home view (the entry state's center). */
function centerCodeHome() {
  return `
    <div class="wr-ContentWrapper">
      <div class="wr-ChannelContainerCentered"></div>
      <header class="wr-CenterHeader">
        <div class="wr-CenterHeaderCenter"></div>
        <div class="wr-CenterHeaderRight">
          <span class="wr-TriggerGroup">
            <button class="wr-Button wr-Button--secondary wr-Button--large" type="button">
              <span class="wr-ButtonLabel">
                <span class="wr-ButtonLabelContent">
                  <span class="wr-ButtonLabelText">下载桌面端</span>
                  ${icons.download}
                </span>
              </span>
            </button>
          </span>
        </div>
      </header>
      <div class="wr-Workspace">
        <div class="wr-WelcomeTitleWrapper">
          <div class="wr-TraeWorkTitle">
            <div class="wr-AnimationContainer">
              <div class="wr-MainTextContainer">
                <span class="wr-TitleIcon">${icons.icon13}</span>
                <span class="wr-TitleText">Code</span>
                <span class="wr-WithTraeText"><span class="wr-WithTraeInner">with TRAE</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="wr-HomeMessageInput">
        <div class="wr-MessageInputContainer">
          <div class="wr-MessageInputToastContainer"></div>
          <div class="wr-MessageInputEditorWrapper">
            <div class="wr-ChatInput is-focused is-empty">
              <div class="wr-ChatInputEditorPart">
                <div class="wr-ChatInputUpperArea">
                  <div class="wr-ChatInputSlotHeader"></div>
                  <div class="wr-ChatInputInputBoxWrapper">
                    <div class="wr-ChatInputPlaceholder" id="chat-input-v2-placeholder-MessageEditor" style="display: block">帮你编写代码、调试 Bug、优化性能等开发工作，交付生产级代码产物。</div>
                    <div class="wr-ChatInputEditable" contenteditable="true" role="textbox" spellcheck="true">
                      <p class="wr-ChatInputParagraph"><br /></p>
                    </div>
                  </div>
                </div>
                <div class="wr-ChatInputLowerContent">
                  <div class="wr-ChatInputLowerLeft">
                    <div class="wr-ChatInputLeftBar">
                      <span class="wr-Trigger">
                        <button class="wr-MessageInputToolbarIconBtn" type="button" aria-expanded="false" aria-label="添加文件及更多">
                          ${icons.add}
                        </button>
                      </span>
                      <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden />
                      <span class="wr-Trigger">
                        <span class="wr-TriggerGroup">
                          <button class="wr-MessageInputPluginToolbar" type="button" aria-label="调用插件">
                            <span class="wr-MessageInputPluginToolbarIconWrapper">${icons.Plugin_puzzle_piece}</span>
                          </button>
                        </span>
                      </span>
                    </div>
                    <div class="wr-ChatInputLeftSelect">
                      <div class="wr-ModelSelectArea">
                        <div class="wr-ModelSelectAreaModel">
                          <div>
                            <div class="wr-ModelSelect">
                              <button class="wr-ModelSelectTrigger" role="combobox" aria-expanded="false" type="button">
                                <div class="wr-ModelSelectTriggerValue"><span>Auto Mode</span></div>
                                <span class="wr-ModelSelectTriggerArrow" aria-hidden="true"><span>${icons.up}</span></span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="wr-ChatInputLowerRight">
                    <div class="wr-ChatInputToolbarRight">
                      <div>
                        <span class="wr-Trigger">
                          <span>
                            <button class="wr-VoicePluginButton" type="button">
                              <span>${icons.microphone}</span>
                            </button>
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <span class="wr-TriggerGroup">
                    <span class="wr-Trigger">
                      <span>
                        <button class="wr-SendButton" type="button">
                          <span>${icons.chat}</span>
                        </button>
                      </span>
                    </span>
                  </div>
                </div>
                <div class="wr-ChatInputSlotOverlay"></div>
              </div>
              <div class="wr-InputBarContainer">
                <div class="wr-InputBarLeft">
                  <button class="wr-InputBarButton" type="button" disabled>
                    <span class="wr-InputBarButtonIcon"><span>${icons.Github}</span></span>
                  </button>
                  <div class="wr-InputBarButtonContent">
                    <span class="wr-InputBarButtonPlaceholder">选择仓库（可选）</span>
                    <span class="wr-InputBarButtonArrow"><span>${icons.loading}</span></span>
                  </div>
                </div>
                <button class="wr-InputBarButton" type="button">
                  <span class="wr-InputBarButtonIcon"><span>${icons.Disk}</span></span>
                </button>
                <div class="wr-InputBarButtonContent">
                  <span class="wr-InputBarButtonText">默认环境</span>
                  <span class="wr-InputBarButtonArrow"><span>${icons.Down}</span></span>
                </div>
              </div>
              <div class="wr-ShowcaseWrapper">
                <div class="wr-ShowcaseSection">
                  <div class="wr-ChipContainer">
                    <div class="wr-Chip">
                      <span class="wr-ChipIcon">${icons.showcase_icon_app_application}</span>
                      <span class="wr-ChipText">应用开发</span>
                    </div>
                    <div class="wr-Chip">
                      <span class="wr-ChipIcon">${icons.showcase_icon_project_understanding}</span>
                      <span class="wr-ChipText">项目理解</span>
                    </div>
                    <div class="wr-Chip">
                      <span class="wr-ChipIcon">${icons.showcase_icon_game}</span>
                      <span class="wr-ChipText">游戏创意</span>
                    </div>
                    <div class="wr-Chip">
                      <span class="wr-ChipIcon">${icons.showcase_icon_automation_tools}</span>
                      <span class="wr-ChipText">工具脚本</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/** Full desktop entry tree. */
function entryDesktop() {
  return `
    <div class="wr-Layout">
      <div class="wr-Container wr-Container--horizontal">
        <div class="wr-Content">
          ${sidebarDesktop({
            navItems: [
              { icon: 'chatNew', text: '新建任务', active: true, hotkey: ['⌘', '⌃', 'N'] },
              { icon: 'marketplace', text: '插件市场' },
              { icon: 'automation', text: '自动化' },
              { icon: 'template', text: '模板库' },
            ],
          })}
          <main class="wr-Main" id="main-container">
            ${centerCodeHome()}
          </main>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Render + interactions
// ---------------------------------------------------------------------------

const root = document.getElementById('root');

function render() {
  root.innerHTML = entryDesktop();
  // The captured entry page autofocuses the chat input (focus signal).
  const editable = root.querySelector('.wr-ChatInputEditable');
  if (editable) editable.focus();
}

render();