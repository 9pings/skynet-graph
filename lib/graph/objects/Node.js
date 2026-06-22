/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */


var Entity = require('./Entity');

// A graph vertex: a thin wrapper over an Entity (which carries its facts + concepts)
// that additionally tracks adjacency — _incoming / _outgoing segment ids, kept in
// sync by Segment._onTargetChange / _onOriginChange.
function Node( _, graph, parentMutation ) {
    this.init(_, graph);
};
Node.prototype = {
    init              : function ( _, graph, parentMutation ) {
        this._outgoing = [];
        this._incoming = [];
        this._id       = _._id;

        this._etty = new Entity(
            {
                _id     : _._id,
                Node : true
            },
            graph
        );

        graph._mapsByConcept["Node"]=graph._mapsByConcept["Node"]||[];
        graph._mapsByConcept["Node"].push(_._id);

        !__SERVER__ && this._etty.follow("_autokill", this._killMe, this);

        this._etty.update(_,graph);
    },
    _killMe: function ( n, o ) {
        this._etty.unRefAll();
    },
    specialize        : function () {
        return this._etty.specialize();
    }
};

module.exports = Node;