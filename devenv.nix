{ inputs, pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = inputs.nodeNixpkgs.legacyPackages.${pkgs.system}.nodejs_latest;
    pnpm = {
      enable = true;
      package = pkgs.pnpm_11.override {
        nodejs = inputs.nodeNixpkgs.legacyPackages.${pkgs.system}.nodejs_latest;
      };
    };
  };

  scripts.development-tool-versions.exec = ''
    printf 'node=%s\n' "$(node --version)"
    printf 'pnpm=%s\n' "$(pnpm --version)"
  '';

  enterTest = ''
    pnpm install --frozen-lockfile
    pnpm check
    pnpm pack:check
  '';
}
