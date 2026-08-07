export interface MenuItem {
  text: string;
  url?: string;
  icon?: string;
  label?: string;
  highlight?: boolean;
  is_header?: boolean;
  is_divider?: boolean;
  children?: MenuItem[];
}
