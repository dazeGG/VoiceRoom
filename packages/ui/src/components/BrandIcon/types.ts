export interface BrandIconProps {
  icon: {
    icon: readonly [
      number,
      number,
      readonly string[] | readonly (string | number)[],
      string,
      string | readonly string[]
    ];
  };
  size?: '1x' | 'sm' | 'lg';
}
