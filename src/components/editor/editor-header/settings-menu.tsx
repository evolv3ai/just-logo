import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { FileDownIcon, FileUpIcon } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  editorToSpec,
  importSettingsFile,
  serializeSettings,
} from '@/lib/settings-io';
import { Kbd } from '@/components/ui/kbd';
import { useIcons } from '@/hooks/use-icons';
import { Button } from '@/components/ui/button';
import { useEditor } from '@/components/providers/editor-provider';

const SettingsMenu = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { data: icons, isError } = useIcons();
  const {
    iconSettings,
    backgroundSettings,
    updateIconSettings,
    updateBackgroundSettings,
  } = useEditor();

  useHotkeys('j', () => handleExport());
  useHotkeys('i', () => fileInputRef.current?.click());

  const handleExport = () => {
    const result = editorToSpec(iconSettings, backgroundSettings);
    if (!result.ok) {
      toast.error(`Export failed: ${result.message}.`);
      return;
    }

    const url = URL.createObjectURL(
      new Blob([serializeSettings(result.spec)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.download = 'logo.json';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // so picking the same file again fires another change event
    e.target.value = '';
    if (!file) return;

    const result = await importSettingsFile(
      file,
      icons
        ? { status: 'ready', icons }
        : { status: isError ? 'error' : 'pending' },
    );
    if (!result.ok) {
      toast.error(`Import failed: ${result.message}.`);
      return;
    }

    updateIconSettings(result.iconSettings);
    updateBackgroundSettings(result.backgroundSettings);
    toast.success(`Imported settings from ${file.name}.`);
  };

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger>
          <Button variant="outline" onClick={handleExport}>
            <FileDownIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Export Settings <Kbd>J</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUpIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Import Settings <Kbd>I</Kbd>
        </TooltipContent>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImport}
      />
    </div>
  );
};

export default SettingsMenu;
