(() => {
    'use strict';

    class PlaylistView {
        constructor(options = {}) {
            this.panelId = options.panelId || 'playlistDetailsPanel';
            this.viewId = options.viewId || 'playlistView';
            this.scrollContainerId = options.scrollContainerId || 'musicList';

            this.panel = null;
            this.view = null;
            this.scrollEl = null;
            this.panelObserver = null;

            this.mounted = false;
            this.active = false;
            this.progress = -1;
            this.latestScrollTop = 0;
            this.collapseDistance = 220;
            this.lastBgImage = '';
            this.rafId = 0;

            this.onScroll = this.onScroll.bind(this);
            this.onResize = this.onResize.bind(this);
            this.onPanelMutate = this.onPanelMutate.bind(this);
        }

        mount() {
            if (this.mounted) return;

            this.panel = document.getElementById(this.panelId);
            this.view = document.getElementById(this.viewId);
            this.scrollEl = document.getElementById(this.scrollContainerId);

            if (!this.panel || !this.view || !this.scrollEl) return;
            this.mounted = true;

            this.readCollapseDistance();
            this.syncBackgroundImage();
            this.syncActiveState();

            this.scrollEl.addEventListener('scroll', this.onScroll, { passive: true });
            window.addEventListener('resize', this.onResize, { passive: true });

            this.panelObserver = new MutationObserver(this.onPanelMutate);
            this.panelObserver.observe(this.panel, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });

            this.latestScrollTop = this.scrollEl.scrollTop || 0;
            this.requestApply();
        }

        destroy() {
            if (!this.mounted) return;

            this.scrollEl.removeEventListener('scroll', this.onScroll);
            window.removeEventListener('resize', this.onResize);

            if (this.panelObserver) {
                this.panelObserver.disconnect();
                this.panelObserver = null;
            }

            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = 0;
            }

            this.reset();
            this.mounted = false;
        }

        onPanelMutate() {
            this.syncActiveState();
            this.syncBackgroundImage();
            if (this.active) this.requestApply();
        }

        onResize() {
            if (!this.view) return;
            this.readCollapseDistance();
            if (!this.active) return;
            this.latestScrollTop = this.scrollEl ? (this.scrollEl.scrollTop || 0) : 0;
            this.requestApply();
        }

        onScroll() {
            this.latestScrollTop = this.scrollEl ? (this.scrollEl.scrollTop || 0) : 0;
            if (!this.active) return;
            this.requestApply();
        }

        syncActiveState() {
            if (!this.panel) return;

            const visible = this.panel.style.display !== 'none';
            if (visible === this.active) return;

            this.active = visible;
            if (!this.active) {
                this.reset();
                return;
            }

            this.readCollapseDistance();
            this.latestScrollTop = this.scrollEl ? (this.scrollEl.scrollTop || 0) : 0;
            this.requestApply();
        }

        syncBackgroundImage() {
            if (!this.panel || !this.view) return;

            const bg = this.panel.style.backgroundImage && this.panel.style.backgroundImage !== ''
                ? this.panel.style.backgroundImage
                : 'none';

            if (bg === this.lastBgImage) return;
            this.lastBgImage = bg;

            this.view.style.setProperty('--pv-bg-image', bg);
            this.panel.classList.toggle('playlist-has-bg', bg !== 'none');
        }

        readCollapseDistance() {
            if (!this.view) return;
            const styles = window.getComputedStyle(this.view);
            const value = parseFloat(styles.getPropertyValue('--pv-collapse-distance'));
            this.collapseDistance = Number.isFinite(value) && value > 0 ? value : 220;
        }

        requestApply() {
            if (this.rafId) return;

            this.rafId = requestAnimationFrame(() => {
                this.rafId = 0;
                this.applyProgress();
            });
        }

        applyProgress() {
            if (!this.view || !this.active) return;

            const next = this.collapseDistance > 0
                ? Math.min(1, Math.max(0, this.latestScrollTop / this.collapseDistance))
                : 0;

            if (Math.abs(next - this.progress) < 0.001) return;
            this.progress = next;

            this.view.style.setProperty('--pv-progress', next.toFixed(4));
            this.panel.classList.toggle('is-collapsed', next >= 0.995);
        }

        reset() {
            if (!this.view || !this.panel) return;

            this.progress = -1;
            this.latestScrollTop = 0;
            this.view.style.setProperty('--pv-progress', '0');
            this.panel.classList.remove('is-collapsed');
        }

        refresh() {
            if (!this.mounted) return;
            this.syncBackgroundImage();
            this.readCollapseDistance();
            this.latestScrollTop = this.scrollEl ? (this.scrollEl.scrollTop || 0) : 0;
            this.requestApply();
        }
    }

    window.PlaylistView = PlaylistView;
    window.playlistView = new PlaylistView();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.playlistView.mount(), { once: true });
    } else {
        window.playlistView.mount();
    }
})();
