import { inject, provide, type InjectionKey, type Ref } from 'vue';
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuItemIndicator,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from 'reka-ui';

const parts = {
  dropdown: {
    Item: DropdownMenuItem,
    CheckboxItem: DropdownMenuCheckboxItem,
    RadioGroup: DropdownMenuRadioGroup,
    RadioItem: DropdownMenuRadioItem,
    Indicator: DropdownMenuItemIndicator,
    Label: DropdownMenuLabel,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
    Portal: DropdownMenuPortal
  },
  context: {
    Item: ContextMenuItem,
    CheckboxItem: ContextMenuCheckboxItem,
    RadioGroup: ContextMenuRadioGroup,
    RadioItem: ContextMenuRadioItem,
    Indicator: ContextMenuItemIndicator,
    Label: ContextMenuLabel,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
    Portal: ContextMenuPortal
  }
};

const menuKind: InjectionKey<keyof typeof parts> = Symbol('menu-kind');

const menuPortalTarget: InjectionKey<Readonly<Ref<HTMLElement | 'body'>>> = Symbol('menu-portal-target');

export function provideMenu(kind: keyof typeof parts, target: Readonly<Ref<HTMLElement | 'body'>>): void {
  provide(menuKind, kind);
  provide(menuPortalTarget, target);
}

export function useMenuPortalTarget() {
  return inject(menuPortalTarget);
}

export function useMenuParts() {
  return parts[inject(menuKind, 'dropdown')];
}
