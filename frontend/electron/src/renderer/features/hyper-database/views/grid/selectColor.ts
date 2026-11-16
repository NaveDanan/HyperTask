import { SelectOptionColorPB } from '@shared/protobuf/hyper-database2/select_option_entities_pb';

/** Core colour IDs stay intact; semantic badge tokens work in both themes. */
export function HyperGridSelectColor(color: SelectOptionColorPB) {
  switch (color) {
  case SelectOptionColorPB.Green:
  case SelectOptionColorPB.Lime:
    return 'success-light';
  case SelectOptionColorPB.Yellow:
  case SelectOptionColorPB.Orange:
    return 'warning-light';
  case SelectOptionColorPB.Pink:
  case SelectOptionColorPB.LightPink:
    return 'destructive-light';
  case SelectOptionColorPB.Aqua:
  case SelectOptionColorPB.Blue:
  case SelectOptionColorPB.Purple:
    return 'info-light';
  default:
    return 'secondary';
  }
}
