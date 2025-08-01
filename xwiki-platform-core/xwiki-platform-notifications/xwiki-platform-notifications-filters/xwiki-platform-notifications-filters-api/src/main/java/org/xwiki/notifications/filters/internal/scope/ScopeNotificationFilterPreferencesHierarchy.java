/*
 * See the NOTICE file distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation; either version 2.1 of
 * the License, or (at your option) any later version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this software; if not, write to the Free
 * Software Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 * 02110-1301 USA, or see the FSF site: http://www.fsf.org.
 */
package org.xwiki.notifications.filters.internal.scope;

import java.util.Iterator;
import java.util.List;

import org.apache.commons.lang3.builder.EqualsBuilder;
import org.apache.commons.lang3.builder.HashCodeBuilder;
import org.xwiki.notifications.filters.NotificationFilterType;
import org.xwiki.text.XWikiToStringBuilder;

/**
 * A hierarchy of scope notification filter preferences.
 *
 * @version $Id$
 * @since 9.9RC1
 */
public class ScopeNotificationFilterPreferencesHierarchy
{
    private List<ScopeNotificationFilterPreference> preferences;

    /**
     * Construct a hierarchy of scope notification filter preferences.
     * @param preferences a list of scope notification filter preferences.
     */
    public ScopeNotificationFilterPreferencesHierarchy(
            List<ScopeNotificationFilterPreference> preferences)
    {
        this.preferences = preferences;

        List<ScopeNotificationFilterPreference> potentialParents = preferences.stream()
            .filter(ScopeNotificationFilterPreference::isPotentialParent)
            .toList();

        List<ScopeNotificationFilterPreference> potentialChildren = preferences.stream()
            .filter(ScopeNotificationFilterPreference::isPotentialChild)
            .toList();

        // Compare potential parents and potential children to see if some are children of the other.
        for (ScopeNotificationFilterPreference potentialParent : potentialParents) {
            for (ScopeNotificationFilterPreference potentialChild : potentialChildren) {
                if (potentialChild == potentialParent) {
                    continue;
                }
                if (potentialParent.isParentOf(potentialChild)) {
                    potentialParent.addChild(potentialChild);
                }
            }
        }
    }

    /**
     * @return an iterator to get top level exclusive filters (ie the black list)
     */
    public Iterator<ScopeNotificationFilterPreference> getExclusiveFiltersThatHasNoParents()
    {
        return preferences.stream().filter(
            pref -> !pref.hasParent() && pref.getFilterType() == NotificationFilterType.EXCLUSIVE
        ).iterator();
    }

    /**
     * @return an iterator to get top level inclusive filters (ie the white list)
     */
    public Iterator<ScopeNotificationFilterPreference> getInclusiveFiltersThatHasNoParents()
    {
        return preferences.stream().filter(
            pref -> !pref.hasParent() && pref.getFilterType() == NotificationFilterType.INCLUSIVE
        ).iterator();
    }

    /**
     * @return if the hierarchy is empty
     */
    public boolean isEmpty()
    {
        return preferences.isEmpty();
    }

    @Override
    public boolean equals(Object o)
    {
        if (this == o) {
            return true;
        }

        if (o == null || getClass() != o.getClass()) {
            return false;
        }

        ScopeNotificationFilterPreferencesHierarchy that = (ScopeNotificationFilterPreferencesHierarchy) o;

        return new EqualsBuilder()
            .append(preferences, that.preferences)
            .isEquals();
    }

    @Override
    public int hashCode()
    {
        return new HashCodeBuilder(23, 37)
            .append(preferences)
            .toHashCode();
    }

    @Override
    public String toString()
    {
        return new XWikiToStringBuilder(this)
            .append("preferences", preferences)
            .toString();
    }
}
