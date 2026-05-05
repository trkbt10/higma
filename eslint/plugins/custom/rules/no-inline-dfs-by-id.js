/**
 * @file Disallow hand-rolled depth-first tree lookup by id.
 *
 * Slot lookup by id has a single SoT in @higma-primitives/tree. This
 * rule catches the common local reimplementation shape: a loop over a
 * tree collection that compares a node id to a target id and then
 * descends recursively into children.
 */

function isIdMemberAccess(node) {
  return (
    node &&
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property &&
    node.property.type === "Identifier" &&
    node.property.name === "id"
  );
}

function isIdLikeIdentifier(node) {
  return node && node.type === "Identifier" && /id$/iu.test(node.name);
}

function isIdComparison(node) {
  if (!node || node.type !== "BinaryExpression" || node.operator !== "===") {
    return false;
  }
  return (
    (isIdMemberAccess(node.left) && isIdLikeIdentifier(node.right)) ||
    (isIdMemberAccess(node.right) && isIdLikeIdentifier(node.left))
  );
}

function containsIdComparison(node) {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (isIdComparison(node)) {
    return true;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value) && value.some(containsIdComparison)) {
      return true;
    }
    if (value && typeof value === "object" && containsIdComparison(value)) {
      return true;
    }
  }
  return false;
}

function containsRecursiveDescent(node, currentFunctionName) {
  if (!node || typeof node !== "object" || !currentFunctionName) {
    return false;
  }
  if (
    node.type === "CallExpression" &&
    node.callee &&
    node.callee.type === "Identifier" &&
    node.callee.name === currentFunctionName
  ) {
    return true;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value) && value.some((child) => containsRecursiveDescent(child, currentFunctionName))) {
      return true;
    }
    if (value && typeof value === "object" && containsRecursiveDescent(value, currentFunctionName)) {
      return true;
    }
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow local recursive DFS-by-id implementations outside the tree lookup SoT.",
    },
    schema: [],
    messages: {
      noInlineDfsById: "Use dfsById from @higma-primitives/tree instead of hand-rolled recursive lookup by id.",
    },
  },
  create(context) {
    const functionStack = [];

    return {
      FunctionDeclaration(node) {
        functionStack.push(node.id ? node.id.name : undefined);
      },
      "FunctionDeclaration:exit"() {
        functionStack.pop();
      },
      ForOfStatement(node) {
        const currentFunctionName = functionStack.at(-1);
        if (!containsIdComparison(node.body)) {
          return;
        }
        if (!containsRecursiveDescent(node.body, currentFunctionName)) {
          return;
        }
        context.report({ node, messageId: "noInlineDfsById" });
      },
    };
  },
};
