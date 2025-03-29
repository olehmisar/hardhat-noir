export function generateNargoToml(name: string) {
  return `
[package]
name = "${name}"
type = "bin"
authors = [""]

[dependencies]
`.trimStart();
}

export function generateMain() {
  return `
fn main(x: Field, y: pub Field) {
    assert(x != y);
}

#[test]
fn test_main() {
    main(1, 2);

    // Uncomment to make test fail
    // main(1, 1);
}
`.trimStart();
}

export function generateLib() {
  return `
fn not_equal(x: Field, y: Field) -> bool {
    x != y
}

#[test]
fn test_not_equal() {
    assert(not_equal(1, 2));

    // Uncomment to make test fail
    // assert(not_equal(1, 1));
}
`.trimStart();
}
