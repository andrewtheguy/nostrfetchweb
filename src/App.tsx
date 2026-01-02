import { useState, useCallback } from 'react';
import { PublicKeyEntry } from './components/PublicKeyEntry';
import { FileList } from './components/FileList';
import { PreviewModal } from './components/PreviewModal';
import { DownloadModal } from './components/DownloadModal';
import type { FileEntry } from './lib/types';
import './App.css';

type AppState =
  | { screen: 'entry' }
  | { screen: 'browsing'; pubkey: string }
  | { screen: 'downloading'; pubkey: string; file: FileEntry }
  | { screen: 'previewing'; pubkey: string; file: FileEntry };

function App() {
  const [state, setState] = useState<AppState>({ screen: 'entry' });

  const handleKeySubmit = useCallback((pubkey: string) => {
    setState({ screen: 'browsing', pubkey });
  }, []);

  const handleBack = useCallback(() => {
    setState({ screen: 'entry' });
  }, []);

  const handleDownload = useCallback((file: FileEntry) => {
    if (state.screen === 'browsing') {
      setState({ screen: 'downloading', pubkey: state.pubkey, file });
    }
  }, [state]);

  const handleCloseDownload = useCallback(() => {
    if (state.screen === 'downloading') {
      setState({ screen: 'browsing', pubkey: state.pubkey });
    }
  }, [state]);

  const handlePreview = useCallback((file: FileEntry) => {
    if (state.screen === 'browsing') {
      setState({ screen: 'previewing', pubkey: state.pubkey, file });
    }
  }, [state]);

  const handleClosePreview = useCallback(() => {
    if (state.screen === 'previewing') {
      setState({ screen: 'browsing', pubkey: state.pubkey });
    }
  }, [state]);

  const showFileList = state.screen === 'browsing' || state.screen === 'downloading' || state.screen === 'previewing';
  const pubkey = state.screen !== 'entry' ? state.screen === 'browsing' || state.screen === 'downloading' || state.screen === 'previewing' ? state.pubkey : '' : '';

  return (
    <div className="app">
      {state.screen === 'entry' && (
        <PublicKeyEntry onSubmit={handleKeySubmit} />
      )}

      {showFileList && (
        <FileList
          pubkey={pubkey}
          onDownload={handleDownload}
          onPreview={handlePreview}
          onBack={handleBack}
        />
      )}

      {state.screen === 'downloading' && (
        <DownloadModal
          file={state.file}
          pubkey={state.pubkey}
          onClose={handleCloseDownload}
        />
      )}

      {state.screen === 'previewing' && (
        <PreviewModal
          file={state.file}
          pubkey={state.pubkey}
          onClose={handleClosePreview}
        />
      )}
    </div>
  );
}

export default App;
