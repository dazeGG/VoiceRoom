export type AvatarCropShape = 'circle' | 'squircle';

export interface AvatarCropDialogProps {
  file: File | null;
  name: string;
  open: boolean;
  shape: AvatarCropShape;
  title: string;
  kind: 'user' | 'room';
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void>;
}
