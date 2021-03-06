var Git = require('nodegit');
var Future = require('fibers/future');
var util = require('./../util');
var fs = require('fs');

exports.load = function (root, def, blockReadFunc) {

  // We need a future here because nodegit is inherently async working with promises,
  // whereas the rest of the code is sync.
  // Ideally, the rest of the code would be reworked to work with promises, too
  // See also https://github.com/fabric8io/fish-pepper/issues/4
  var future = new Future();
  readBlocksFromGit(root, def).then(function (blocks) {
    future.return(blocks)
  }).catch(function (err) {
    future.throw(err);
  });
  return future.wait();

  // ===============================================================

  function readBlocksFromGit(root, def) {
    var name = (def.url.match(/.*\/([^/]+?)(?:\..*)?$/))[1];
    var base = root + "/.fp-git-blocks";
    util.ensureDir(base);
    var path = base + "/" + name;

    var gitCloneOrPull;
    if (fs.existsSync(path)) {
      // Open and pull
      gitCloneOrPull =
        Git.Repository.open(path)
          .then(function (repo) {
            console.log("  Pulling " + def.url.blue + branchOrTagLabel(def));
            return pull(repo, def.branch)
          });
    } else {
      // Clone
      console.log("  Cloning " + def.url.blue + branchOrTagLabel(def));
      gitCloneOrPull =
        Git.Clone(def.url, path, {fetchOpts: {callbacks: getRemoteCallbacks()}});
    }

    return gitCloneOrPull
      .then(function (repo) {
        return switchToBranchOrTag(repo, def)
      })
      .then(function () {
        return blockReadFunc(getBlocksPath(path, def));
      })
      .catch(function (error) {
        throw new Error(error);
      })
  }

  function getBlocksPath(path, def) {
    return path + "/" + (def.path ? def.path : "fish-pepper");
  }

  function switchToBranchOrTag(repo, def) {
    // Check for tag or branch and switch to tag or branch
    if (def.branch) {
      return checkOutBranch(repo, def.branch);
    } else if (def.tag) {
      return checkOutTag(repo, def.tag);
    }
  }

  function getRemoteCallbacks() {
    return {
      certificateCheck: function () {
        return 1;
      }
    };
  }

  function pull(repo, branch) {
    // Optimization: Do a pull only if no tag is given or the tag given differs from the currently checked out tag
    return repo.fetch("origin", {callbacks: getRemoteCallbacks()})
      .then(function () {
        branch = branch || "master";
        return repo.mergeBranches(branch, "origin/" + branch);
      })
      .then(function () {
        return repo;
      })
  }

  function checkOutBranch(repo, branch) {
    return Git.Branch.lookup(repo, "origin/" + branch, Git.Branch.BRANCH.REMOTE)
      .then(function (reference) {
        return checkOutRef(repo, reference);
      });
  }

  function checkOutTag(repo, tag){
    return Git.Reference
      .dwim(repo, "refs/tags/" + tag)
      .then(function (ref) {
          return ref.peel(Git.Object.TYPE.COMMIT);
      })
      .then(function (ref) {
          return repo.getCommit(ref);
      })
      .then(function (commit) {
          return Git.Checkout
            .tree(repo, commit, {checkoutStrategy: Git.Checkout.STRATEGY.SAFE})
            .then(function () {
                console.log("  Checkout: HEAD " + commit.id());
                return repo.setHeadDetached(commit);
            })
      });
  }

  function checkOutCommit(repo, commit) {
    var signature = Git.Signature.default(repo);
    console.log("  Checkout: HEAD " + commit.id());
    repo.setHeadDetached(commit.id());
    return Git.Checkout.head(repo, {
      checkoutStrategy: Git.Checkout.STRATEGY.FORCE
    });
  }

  function checkOutRef(repo, branchRef) {
    var signature = Git.Signature.default(repo);
    console.log("  Set head to " + branchRef);
    repo.setHead(branchRef.name())
      .then(function () {
        return Git.Checkout.head(repo, {
          checkoutStrategy: Git.Checkout.STRATEGY.FORCE
        });
      });
  }

  function branchOrTagLabel(def) {
    if (def.branch || def.tag) {
      var label = def.branch ? " (Branch: " + def.branch + ")" : " (Tag: " + def.tag + ")";
      return label.gray;
    } else {
      return "";
    }
  }

};
