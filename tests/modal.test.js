/**
 * Modal functionality tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppView } from '../src/views/AppView.js';

describe('Modal Functionality', () => {
  let appView;

  beforeEach(() => {
    // Set up DOM with modal elements
    document.body.innerHTML = `
      <div id="file-input"></div>
      <div id="upload-area"></div>
      <div id="url-input"></div>
      <div id="scan-url-btn"></div>
      <div id="process-btn"></div>
      <div id="download-btn"></div>
      <div id="clear-btn"></div>
      <div id="table-container"></div>
      <div id="progress-container"></div>
      <div id="progress-fill"></div>
      <div id="progress-text"></div>
      <div id="readme-btn"></div>
      <div class="modal" id="readme-modal" hidden>
        <div class="modal-content">
          <div class="modal-header">
            <h2>Documentation</h2>
            <button type="button" class="modal-close" id="readme-close" aria-label="Close documentation">
              ✕
            </button>
          </div>
          <div class="modal-body" id="readme-content">
            <div class="loading-skeleton">Loading documentation...</div>
          </div>
        </div>
        <div class="modal-backdrop"></div>
      </div>
      <div id="error-toast"></div>
      <div id="toast-message"></div>
      <div class="toast-close"></div>
    `;

    appView = new AppView();
  });

  describe('Modal State Management', () => {
    it('should initialize with modal hidden', async () => {
      await appView.init();
      
      const modal = document.getElementById('readme-modal');
      expect(modal.hidden).toBe(true);
    });

    it('should show modal when showReadmeModal is called', async () => {
      // Mock fetch for README content
      global.fetch = vi.fn().mockResolvedValue({
        text: () => Promise.resolve('# Test README\nThis is a test.')
      });

      await appView.init();
      await appView.showReadmeModal();
      
      const modal = document.getElementById('readme-modal');
      expect(modal.hidden).toBe(false);
    });

    it('should hide modal when hideReadmeModal is called', async () => {
      await appView.init();
      
      // First show the modal
      await appView.showReadmeModal();
      
      // Then hide it
      appView.hideReadmeModal();
      
      const modal = document.getElementById('readme-modal');
      expect(modal.hidden).toBe(true);
    });
  });

  describe('Modal Event Handlers', () => {
    it('should hide modal when close button is clicked', async () => {
      await appView.init();
      
      // Show the modal first
      await appView.showReadmeModal();
      expect(document.getElementById('readme-modal').hidden).toBe(false);
      
      // Click the close button
      const closeButton = document.getElementById('readme-close');
      closeButton.click();
      
      // Modal should be hidden
      expect(document.getElementById('readme-modal').hidden).toBe(true);
    });

    it('should hide modal when backdrop is clicked', async () => {
      await appView.init();
      
      // Show the modal first
      await appView.showReadmeModal();
      expect(document.getElementById('readme-modal').hidden).toBe(false);
      
      // Click the backdrop
      const modal = document.getElementById('readme-modal');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: modal });
      modal.dispatchEvent(clickEvent);
      
      // Modal should be hidden
      expect(document.getElementById('readme-modal').hidden).toBe(true);
    });

    it('should hide modal when escape key is pressed', async () => {
      await appView.init();
      
      // Show the modal first
      await appView.showReadmeModal();
      expect(document.getElementById('readme-modal').hidden).toBe(false);
      
      // Press escape key
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escapeEvent);
      
      // Modal should be hidden
      expect(document.getElementById('readme-modal').hidden).toBe(true);
    });
  });

  describe('README Content Loading', () => {
    it('should load README content when modal is shown', async () => {
      const mockMarkdown = '# Test README\nThis is a test.';
      global.fetch = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(mockMarkdown)
      });

      await appView.init();
      await appView.showReadmeModal();
      
      expect(global.fetch).toHaveBeenCalledWith('/README.md');
      
      const content = document.getElementById('readme-content');
      expect(content.innerHTML).toContain('Test README');
    });

    it('should handle README loading errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await appView.init();
      await appView.showReadmeModal();
      
      const content = document.getElementById('readme-content');
      expect(content.innerHTML).toContain('Failed to load documentation');
    });

    it('should not reload README content on subsequent opens', async () => {
      const mockMarkdown = '# Test README\nThis is a test.';
      global.fetch = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(mockMarkdown)
      });

      await appView.init();
      
      // Show modal first time
      await appView.showReadmeModal();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      // Hide and show again
      appView.hideReadmeModal();
      await appView.showReadmeModal();
      
      // Fetch should still only be called once
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
